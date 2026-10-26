import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  CloudRain,
  CloudSun,
  Cpu,
  Download,
  FileText,
  Gauge,
  LayoutDashboard,
  MapPin,
  Menu,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Wind,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "../contexts/ThemeContext";

type Reading = Record<string, any>;
type SimulatorControls = {
  solarIrradiance: number;
  windSpeed: number;
  loadDemand: number;
  batteryLevel: number;
  weatherScenario: "clear" | "cloudy" | "stormy" | "calm";
  faultInjection: "none" | "solar" | "wind" | "battery" | "load" | "all";
};
type ApiState = {
  current: Reading | null;
  analytics: Reading | null;
  prediction: Reading | null;
  alerts: Reading[];
  error: string;
};
type ChatMessage = { role: "user" | "assistant"; text: string };
const initialState: ApiState = {
  current: null,
  analytics: null,
  prediction: null,
  alerts: [],
  error: "",
};
const nav = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "simulator", label: "Simulator", icon: Activity },
  { id: "predictor", label: "Climate & output predictor", icon: CloudSun },
  { id: "history", label: "Daily generation history", icon: FileText },
];

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).error ||
        `Request failed (${response.status})`
    );
  return response.json();
}
const n = (value: unknown, digits = 0) =>
  typeof value === "number" ? value.toFixed(digits) : "—";
const downloadCsv = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const ago = (timestamp?: number) =>
  timestamp
    ? `${Math.max(0, Math.round((Date.now() - timestamp) / 1000))}s ago`
    : "—";
const modeLabel = (current: Reading | null) => {
  if (!current) return "CONNECTING";
  const source = current.mode === "hardware" ? "LIVE HARDWARE" : "SIMULATION";
  return Date.now() - current.timestamp > 15_000 ? `OFFLINE / STALE · ${source}` : source;
};
const localDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

function Badge({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "blue" | "amber" | "red" | "slate";
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  unit,
  accent = "mint",
  helper,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  helper?: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${accent}`}>
        <Icon size={18} />
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      {helper && <div className="metric-helper">{helper}</div>}
    </div>
  );
}
function SectionTitle({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
function StatusRow({
  label,
  value,
  tone = "green",
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "red" | "blue" | "slate";
}) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [range, setRange] = useState("24h");
  const [customRange, setCustomRange] = useState(() => ({
    from: localDateTime(new Date(Date.now() - 86_400_000)),
    to: localDateTime(new Date()),
  }));
  const [state, setState] = useState<ApiState>(initialState);
  const [config, setConfig] = useState<SimulatorControls>({
    solarIrradiance: 720,
    windSpeed: 8.2,
    loadDemand: 2.4,
    batteryLevel: 68,
    weatherScenario: "clear",
    faultInjection: "none",
  });
  const [running, setRunning] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatModelStatus, setChatModelStatus] = useState<{ status: string; progress: number | null }>({
    status: "not_started",
    progress: null,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Hi! How can I help you today?" },
  ]);
  const current = state.current;
  const isLiveConnected =
    current?.mode === "hardware" &&
    current?.device?.connection === "connected" &&
    Date.now() - current.timestamp <= 15_000;
  const liveReading = isLiveConnected ? current : null;

  const refresh = useCallback(async () => {
    try {
      const analyticsQuery = new URLSearchParams({ range });
      if (range === "custom") {
        analyticsQuery.set("from", new Date(customRange.from).toISOString());
        analyticsQuery.set("to", new Date(customRange.to).toISOString());
      }
      const [nextCurrent, nextAnalytics, nextPrediction, nextAlerts] =
        await Promise.all([
          api("/api/energy/current"),
          api(`/api/energy/analytics?${analyticsQuery}`),
          api("/api/energy/prediction"),
          api("/api/alerts"),
        ]);
      setState({
        current: nextCurrent,
        analytics: nextAnalytics,
        prediction: nextPrediction,
        alerts: nextAlerts.alerts || [],
        error: "",
      });
      setRunning(nextCurrent.device?.stream !== "paused");
      if (nextCurrent.mode === "simulator" && typeof nextCurrent.batteryLevel === "number")
        setConfig(old => ({ ...old, batteryLevel: nextCurrent.batteryLevel }));
    } catch (error) {
      setState(old => ({
        ...old,
        error: error instanceof Error ? error.message : "Backend unavailable",
      }));
    }
  }, [range, customRange]);

  useEffect(() => {
    if (!pollingEnabled) return;
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [pollingEnabled, refresh]);

  const postSimulator = async (payload: Record<string, number | string>) => {
    try {
      const result = await api("/api/simulator/config", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setConfig(old => ({ ...old, ...result.config }));
      setRunning(true);
      await refresh();
    } catch (error) {
      setState(old => ({
        ...old,
        error:
          error instanceof Error ? error.message : "Simulator update failed",
      }));
    }
  };
  const toggleSimulator = async () => {
    try {
      await api(running ? "/api/simulator/stop" : "/api/simulator/start", {
        method: "POST",
      });
      setRunning(!running);
      await refresh();
    } catch (error) {
      setState(old => ({
        ...old,
        error:
          error instanceof Error ? error.message : "Simulator action failed",
      }));
    }
  };
  const navigate = async (destination: string) => {
    setView(destination);
    setMobileNavOpen(false);
    if (destination !== "simulator" || current?.mode === "simulator") return;
    try {
      await api("/api/simulator/start", { method: "POST" });
      setRunning(true);
      await refresh();
    } catch (error) {
      setState(old => ({
        ...old,
        error: error instanceof Error ? error.message : "Could not start the simulator.",
      }));
    }
  };
  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const text = chatInput.trim();
    const history = messages.slice(-12).map(({ role, text: content }) => ({
      role,
      content,
    }));
    setMessages(old => [...old, { role: "user", text }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const result = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, history }),
      });
      setMessages(old => [...old, { role: "assistant", text: result.answer }]);
    } catch (error) {
      setMessages(old => [
        ...old,
        {
          role: "assistant",
          text: error instanceof Error ? error.message : "The AI assistant could not respond. Please try again.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };
  useEffect(() => {
    if (!chatLoading) return;
    let active = true;
    const refreshAssistantStatus = async () => {
      try {
        const status = await api("/api/chat/status");
        if (active) setChatModelStatus(status);
      } catch (error) {
        if (active) {
          setState(old => ({
            ...old,
            error: error instanceof Error ? error.message : "Could not check assistant status.",
          }));
        }
      }
    };
    void refreshAssistantStatus();
    const interval = window.setInterval(() => void refreshAssistantStatus(), 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [chatLoading]);
  const chartData = state.analytics?.chart || [];
  const predictionData = state.prediction?.forecast || [];
  const connectionTone =
    current?.device?.connection === "offline"
      ? "red"
      : current?.device?.connection === "delayed"
        ? "amber"
        : current?.device?.connection === "simulation"
          ? "blue"
          : "green";
  const healthItems = useMemo(
    () =>
      [
        [
          "Solar array",
          current?.solarPower == null ? "Not mapped" : "Reading available",
          current?.solarPower == null ? "amber" : "blue",
        ],
        [
          "Wind turbine",
          current?.windPower == null ? "Not mapped" : "Reading available",
          current?.windPower == null ? "amber" : "blue",
        ],
        [
          "Battery",
          current?.batteryState || "—",
          current?.batteryLevel <= 10
            ? "red"
            : current?.batteryLevel <= 20
              ? "amber"
              : "green",
        ],
        [current?.mode === "simulator" ? "Data source" : "ESP32 device", current?.device?.connection || "—", connectionTone],
      ] as const,
    [current, connectionTone]
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Sun size={12} />
            <Wind size={12} />
            <Activity size={12} />
          </div>
          <div>
            <strong>
              HYBRID<span> POWER AI</span>
            </strong>
            <small>ENERGY OPERATIONS</small>
          </div>
        </div>
        <div className="sidebar-label">Workspace</div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => void navigate(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {view === id && <ChevronRight className="nav-arrow" size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="backend-mini">
            <span className="pulse" />
            <div>
              <strong>Backend online</strong>
              <small>Polling every 2.5 sec</small>
            </div>
          </div>
          <div className="sidebar-foot">
            <ShieldCheck size={14} /> SQLite-backed history
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileNavOpen(open => !open)}
            aria-label="Toggle navigation"
            title={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            <Menu size={20} />
          </button>
          <div>
            <div className="crumb">HYBRID POWER / {nav.find(item => item.id === view)?.label.toUpperCase()}</div>
            <h1>{nav.find(item => item.id === view)?.label || "Dashboard"}</h1>
          </div>
          <div className="top-actions">
            <div className="live-chip">
              <span className={`pulse${isLiveConnected ? "" : " pulse-muted"}`} />
              {isLiveConnected ? "LIVE ARDUINO" : view === "simulator" && current?.mode === "simulator" ? "SIMULATION" : "NO LIVE DATA"}
            </div>
            <button
              className="icon-button"
              onClick={() => setChatOpen(!chatOpen)}
              aria-label="Open assistant"
              title="Open the energy assistant chat"
            >
              <Bot size={18} />
            </button>
            <button
              className="icon-button"
              onClick={refresh}
              aria-label="Refresh"
              title="Refresh readings, charts, and alerts"
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="avatar">OP</div>
          </div>
        </header>
        {state.error && (
          <div className="error-banner">
            <AlertTriangle size={16} /> {state.error}
          <button onClick={() => setState(old => ({ ...old, error: "" }))} aria-label="Dismiss error" title="Dismiss this error message">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="content-wrap">
          {view === "dashboard" && (
            <DashboardPage current={liveReading} onOpenSimulator={() => void navigate("simulator")} />
          )}
          {view === "simulator" && (
            <>
              <SectionTitle
                eyebrow="SAFE DEMONSTRATION MODE"
                title="Simulator"
                detail="All readings here are synthetic and never appear on the live dashboard."
                action={<Badge tone="amber">SIMULATED VALUES</Badge>}
              />
              {current?.mode === "simulator" ? (
                <Overview
                  current={current}
                  running={running}
                  config={config}
                  setConfig={setConfig}
                  postSimulator={postSimulator}
                  toggleSimulator={toggleSimulator}
                  alerts={state.alerts}
                  healthItems={healthItems}
                  analytics={state.analytics}
                  onNavigate={destination => void navigate(destination)}
                />
              ) : (
                <div className="panel empty-state">Starting the simulator. Please wait…</div>
              )}
            </>
          )}
          {view === "predictor" && (
            <>
              <ClimatePage />
              <Forecast data={state.prediction} predictionData={predictionData} current={current} />
            </>
          )}
          {view === "history" && <DailyHistoryPage />}
        </div>
      </main>
      {chatOpen && (
        <div className="chat-panel">
          <div className="chat-head">
            <div>
              <div className="eyebrow">CHAT</div>
              <strong>Assistant</strong>
            </div>
            <button className="icon-button" onClick={() => setChatOpen(false)} aria-label="Close assistant" title="Close the energy assistant">
              <X size={16} />
            </button>
          </div>
          <div className="chat-messages">
            {messages.map((message, index) => (
              <div key={index} className={`chat-message ${message.role}`}>
                {message.text}
              </div>
            ))}
            {chatLoading && (
              <div className="chat-message assistant" role="status">
                {chatModelStatus.status === "loading"
                  ? `Getting things ready${chatModelStatus.progress === null ? "..." : ` · ${chatModelStatus.progress}%`}`
                  : chatModelStatus.status === "ready"
                    ? "Thinking..."
                    : "Preparing..."}
              </div>
            )}
          </div>
          <div className="chat-input">
            <input
              value={chatInput}
              onChange={event => setChatInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
              placeholder="Ask anything..."
              disabled={chatLoading}
              aria-label="Message the AI assistant"
            />
            <button onClick={() => void sendChat()} disabled={chatLoading || !chatInput.trim()} aria-label="Send message" title="Send message">
              {chatLoading ? <RefreshCw className="spin" size={15} /> : <ChevronRight size={17} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardPage({
  current,
  onOpenSimulator,
}: {
  current: Reading | null;
  onOpenSimulator: () => void;
}) {
  return (
    <div>
      <SectionTitle
        eyebrow="LIVE DEVICE DASHBOARD"
        title="Your real-time energy readings"
        detail="Only fresh readings from a connected Arduino/ESP32 are shown here. Simulated values never appear on this dashboard."
        action={<Badge tone={current ? "blue" : "amber"}>{current ? "ARDUINO CONNECTED" : "WAITING FOR ARDUINO"}</Badge>}
      />
      {current ? (
        <>
          <div className="analytics-metrics dashboard-live-metrics">
            <Metric icon={Sun} label="Solar output" value={n(current.solarPower, 2)} unit="W" helper="Live sensor reading" accent="yellow" />
            <Metric icon={Wind} label="Wind output" value={n(current.windPower, 2)} unit="W" helper="Live sensor reading" accent="blue" />
            <Metric icon={BatteryCharging} label="Battery charge" value={n(current.batteryLevel, 1)} unit="%" helper={current.batteryLevel == null ? "Not reported by device" : "Live device-reported value"} accent="mint" />
          </div>
          <div className="panel dashboard-device-status">
            <Wifi size={18} />
            <span>Connected device <strong>{current.deviceId}</strong> · last reading {ago(current.timestamp)}</span>
          </div>
        </>
      ) : (
        <div className="panel dashboard-empty">
          <div className="dashboard-empty-icon"><Wifi size={24} /></div>
          <h3>No live Arduino data yet</h3>
          <p>Connect and configure your ESP32 to send authenticated sensor readings. This page will show solar output, wind output, and battery charge only after a fresh real-device reading arrives.</p>
          <button className="control-button running" onClick={onOpenSimulator}>
            Open simulator <ChevronRight size={15} />
          </button>
          <small>The simulator is separate and clearly labeled; it will not fill in this dashboard.</small>
        </div>
      )}
    </div>
  );
}

function DailyHistoryPage() {
  const [mode, setMode] = useState<"hardware" | "simulator">("hardware");
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<Reading | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api(`/api/energy/daily?days=${days}&mode=${mode}`)
      .then(data => {
        if (active) setResult(data);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load daily generation.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [days, mode]);

  const daily = (result?.daily || []) as Reading[];
  const sumEnergy = (field: "solarWh" | "windWh") => {
    const measuredDays = daily.filter(point => typeof point[field] === "number");
    return measuredDays.length ? measuredDays.reduce((sum, point) => sum + point[field], 0) : null;
  };
  const total = daily.reduce((sum, point) => sum + (typeof point.totalGenerationWh === "number" ? point.totalGenerationWh : 0), 0);
  const daysWithTotal = daily.filter(point => typeof point.totalGenerationWh === "number").length;
  const csvExport = () => {
    if (!daily.length) return;
    const fields = ["date", "mode", "solarWh", "windWh", "totalGenerationWh", "sampleCount"];
    const csv = [fields.join(","), ...daily.map(point => fields.map(field => JSON.stringify(point[field] ?? "")).join(","))].join("\n");
    downloadCsv(`daily-generation-${mode}-${days}d.csv`, csv);
  };

  return (
    <div>
      <SectionTitle
        eyebrow="DAILY GENERATION HISTORY"
        title="Energy generated each day"
        detail="Daily watt-hours are integrated from timestamped readings. Missing readings and long gaps are not counted as zero."
        action={<button className="control-button" onClick={csvExport} disabled={daysWithTotal === 0}><Download size={14} /> Download CSV</button>}
      />
      <div className="panel history-controls">
        <label>Data source
          <select value={mode} onChange={event => setMode(event.target.value as "hardware" | "simulator")}>
            <option value="hardware">Real Arduino readings</option>
            <option value="simulator">Simulation readings</option>
          </select>
        </label>
        <label>Show
          <select value={days} onChange={event => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <Badge tone={mode === "hardware" ? "blue" : "amber"}>{result?.label || (mode === "hardware" ? "LIVE HARDWARE DATA" : "SIMULATED DATA")}</Badge>
      </div>
      {error && <div className="error-banner"><AlertTriangle size={16} /> {error}</div>}
      <div className="analytics-metrics">
        <Metric icon={Zap} label="Integrated generation" value={daysWithTotal ? total.toFixed(2) : "—"} unit={daysWithTotal ? "Wh" : ""} helper={`${daysWithTotal} days with valid intervals`} accent="mint" />
        <Metric icon={Sun} label="Solar energy" value={n(sumEnergy("solarWh"), 2)} unit={sumEnergy("solarWh") === null ? "" : "Wh"} helper="Across selected days" accent="yellow" />
        <Metric icon={Wind} label="Wind energy" value={n(sumEnergy("windWh"), 2)} unit={sumEnergy("windWh") === null ? "" : "Wh"} helper="Across selected days" accent="blue" />
      </div>
      <div className="panel daily-history-chart">
        {loading ? <div className="empty-state">Loading daily readings…</div> : daysWithTotal === 0 ? (
          <div className="empty-state">{mode === "hardware" ? "No daily energy history is available for real Arduino readings yet. Connect the device and allow it to collect measurements." : "No simulator history is available for this period."}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Bar dataKey="solarWh" name="Solar (Wh)" stackId="generation" fill="#f4c95d" />
              <Bar dataKey="windWh" name="Wind (Wh)" stackId="generation" fill="#70a7f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {daysWithTotal > 0 && (
        <div className="panel daily-history-list">
          <div className="history-table-head"><strong>Date</strong><strong>Solar</strong><strong>Wind</strong><strong>Total</strong></div>
          {[...daily].reverse().filter(point => point.sampleCount > 0).map(point => (
            <div className="history-table-row" key={point.date}>
              <span>{new Date(`${point.date}T00:00:00`).toLocaleDateString()}</span>
              <span>{point.solarWh == null ? "—" : `${Number(point.solarWh).toFixed(2)} Wh`}</span>
              <span>{point.windWh == null ? "—" : `${Number(point.windWh).toFixed(2)} Wh`}</span>
              <strong>{point.totalGenerationWh == null ? "Incomplete" : `${Number(point.totalGenerationWh).toFixed(2)} Wh`}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardingDialog({ onComplete }: { onComplete: (mode: "simulation" | "live") => void }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"simulation" | "live">("simulation");
  const [panelWatts, setPanelWatts] = useState("");
  const [capacityMah, setCapacityMah] = useState("2400");
  const [units, setUnits] = useState("W");
  const finish = () => {
    if (panelWatts && Number(panelWatts) > 0) localStorage.setItem("hybrid-panel-watts", panelWatts);
    localStorage.setItem("hybrid-battery-capacity-mah", capacityMah);
    localStorage.setItem("hybrid-power-units", units);
    onComplete(mode);
  };
  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="eyebrow">HYBRID POWER AI · SETUP {step + 1}/3</div>
        <h2 id="onboarding-title">{["Choose a data mode", "Set known hardware specs", "Choose display units"][step]}</h2>
        {step === 0 && <div className="onboarding-options">
          <button className={mode === "simulation" ? "onboarding-choice selected" : "onboarding-choice"} onClick={() => setMode("simulation")}><strong>Simulation</strong><span>Start safely with clearly labeled synthetic readings.</span></button>
          <button className={mode === "live" ? "onboarding-choice selected" : "onboarding-choice"} onClick={() => setMode("live")}><strong>Prepare live hardware</strong><span>Live mode stays off until an authenticated device reading arrives.</span></button>
        </div>}
        {step === 1 && <div className="onboarding-fields">
          <label>Solar panel rated power (W)<input type="number" min="0" max="1000" value={panelWatts} onChange={event => setPanelWatts(event.target.value)} placeholder="Unknown" /></label>
          <label>Battery rated capacity (mAh)<input type="number" min="1" max="100000" value={capacityMah} onChange={event => setCapacityMah(event.target.value)} /></label>
          <p>Leave solar rating blank when it is not confirmed. Capacity is a nameplate value, not a state-of-charge measurement.</p>
        </div>}
        {step === 2 && <div className="onboarding-fields">
          <label>Power display units<select value={units} onChange={event => setUnits(event.target.value)}><option value="W">Watts (W)</option><option value="kW">Kilowatts (kW)</option></select></label>
          <p>Nominal energy for the listed 3.7 V, 2400 mAh cell is approximately 8.88 Wh. Usable capacity depends on the verified battery and protection design.</p>
        </div>}
        <div className="onboarding-footer"><span>{step + 1} of 3</span><div>{step > 0 && <button className="text-button" onClick={() => setStep(step - 1)}>Back</button>}{step < 2 ? <button className="control-button running" onClick={() => setStep(step + 1)}>Continue <ChevronRight size={14} /></button> : <button className="control-button running" onClick={finish}>Open dashboard</button>}</div></div>
      </section>
    </div>
  );
}

function SourceAnalytics({
  kind,
  current,
  analytics,
  chartData,
}: {
  kind: "solar" | "wind";
  current: Reading | null;
  analytics: Reading | null;
  chartData: Reading[];
}) {
  const isSolar = kind === "solar";
  const power = isSolar ? current?.solarPower : current?.windPower;
  const voltage = isSolar ? current?.solarVoltage : current?.windVoltage;
  const amperage = isSolar ? current?.solarCurrent : current?.windCurrent;
  const energy = isSolar
    ? analytics?.solarGenerationWh
    : analytics?.windGenerationWh;
  const series = isSolar ? "solar" : "wind";
  return (
    <div>
      <SectionTitle
        eyebrow={isSolar ? "SOLAR ANALYTICS" : "WIND ANALYTICS"}
        title={isSolar ? "Solar generation" : "Wind generation"}
        detail={
          isSolar
            ? "Panel capacity and orientation are not yet calibrated."
            : "Motor output is not a wind-speed measurement; calibration is required."
        }
        action={
          <Badge tone={current?.mode === "hardware" ? "blue" : "amber"}>
            {modeLabel(current)}
          </Badge>
        }
      />
      <div className="analytics-metrics">
        <Metric
          icon={isSolar ? Sun : Wind}
          label="Current power"
          value={n(power, 2)}
          unit="W"
          helper="Source reading"
          accent={isSolar ? "yellow" : "blue"}
        />
        <Metric
          icon={Activity}
          label="Voltage"
          value={n(voltage, 2)}
          unit="V"
          helper="Unavailable unless mapped"
          accent="mint"
        />
        <Metric
          icon={Gauge}
          label="Current"
          value={n(amperage, 3)}
          unit="A"
          helper="Unavailable unless mapped"
          accent="orange"
        />
        <Metric
          icon={Zap}
          label="Energy in history"
          value={n(energy, 2)}
          unit="Wh"
          helper="Integrated from stored samples"
          accent="mint"
        />
      </div>
      <div className="chart-grid">
        <ChartPanel
          title={`${isSolar ? "Solar" : "Wind"} output history`}
          subtitle="Power · W"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey={series}
                name={isSolar ? "Solar" : "Wind"}
                stroke={isSolar ? "#f4c95d" : "#70a7f6"}
                fill={isSolar ? "#f4c95d" : "#70a7f6"}
                fillOpacity={0.16}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
        <div className="panel">
          <SectionTitle
            eyebrow="CAPACITY & CALIBRATION"
            title={isSolar ? "Panel specification" : "Turbine experiment"}
          />
          <p className="technical-note">
            {isSolar
              ? "Panel rated watts, voltage, and maximum current remain unconfigured. Capacity-based utilization is unavailable until the label specifications are entered."
              : "Record generator voltage and current alongside an independent wind-speed reading at several fan settings. Do not infer wind speed from voltage."}
          </p>
          <StatusRow
            label="Calibration status"
            value="Not configured"
            tone="amber"
          />
          <StatusRow
            label="Forecast readiness"
            value="Preliminary"
            tone="amber"
          />
          <StatusRow
            label="Sensor source"
            value={
              current?.mode === "simulator"
                ? "Synthetic scenario"
                : "Device mapping required"
            }
            tone="blue"
          />
        </div>
      </div>
    </div>
  );
}

function BatteryPage({ current }: { current: Reading | null }) {
  const soc = current?.mode === "simulator" ? current?.batteryLevel : null;
  const nominalWh = 3.7 * 2.4;
  const runtimeHours = current?.mode === "simulator" && typeof soc === "number" && typeof current?.loadPower === "number" && current.loadPower > 0
    ? nominalWh * soc / 100 / current.loadPower
    : null;
  return (
    <div>
      <SectionTitle
        eyebrow="BATTERY INTELLIGENCE"
        title="Single-cell storage"
        detail="Initial design rating: 3.7 V, 2400 mAh. Confirm the actual cell and protection design."
        action={<Badge tone="amber">NO AUTOMATIC CONTROL</Badge>}
      />
      <div className="analytics-metrics">
        <Metric
          icon={BatteryCharging}
          label="Battery voltage"
          value={n(current?.batteryVoltage, 2)}
          unit="V"
          helper={
            current?.mode === "simulator"
              ? "Simulated value"
              : "INA219 mapping required"
          }
          accent="violet"
        />
        <Metric
          icon={Activity}
          label="Battery current"
          value={n(current?.batteryCurrent, 3)}
          unit="A"
          helper="Direction depends on sensor orientation"
          accent="blue"
        />
        <Metric
          icon={Gauge}
          label="State of charge"
          value={n(soc)}
          unit="%"
          helper={
            soc == null ? "Unavailable in live mode" : "Synthetic scenario only"
          }
          accent="mint"
        />
        <Metric
          icon={Zap}
          label="Runtime upper bound"
          value={runtimeHours === null ? "—" : runtimeHours.toFixed(2)}
          unit={runtimeHours === null ? "" : "h"}
          helper={runtimeHours === null ? "Unavailable in live mode" : "Idealized simulator estimate; ignores losses"}
          accent="yellow"
        />
      </div>
      <div className="panel">
        <SectionTitle
          eyebrow="ESTIMATION QUALITY"
          title="Runtime unavailable"
        />
        <p className="technical-note">
          Runtime needs measured usable battery energy and a synchronized load
          measurement on the relevant electrical path. Voltage alone is not a
          precise state-of-charge measurement. The TP4056 is a single-cell
          charger; it is not a solar or wind charge controller. No charging or
          switching is controlled by this app.
        </p>
        <StatusRow
          label="Battery measurement quality"
          value={
            current?.mode === "simulator"
              ? "Synthetic"
              : current?.batteryVoltage == null
                ? "No battery sensor mapped"
                : "Voltage only; SOC not inferred"
          }
          tone="amber"
        />
        <StatusRow
          label="Runtime estimate"
          value={runtimeHours === null ? "Unavailable without verified capacity and load" : `${runtimeHours.toFixed(2)} h theoretical upper bound`}
          tone={runtimeHours === null ? "slate" : "amber"}
        />
        <StatusRow label="Nominal stored energy" value={`${nominalWh.toFixed(2)} Wh theoretical`} tone="blue" />
      </div>
    </div>
  );
}

function ConsumptionPage({
  current,
  analytics,
  chartData,
}: {
  current: Reading | null;
  analytics: Reading | null;
  chartData: Reading[];
}) {
  return (
    <div>
      <SectionTitle
        eyebrow="POWER CONSUMPTION"
        title="Load and energy use"
        detail="Energy integrates measured power over timestamp intervals; gaps are not treated as zero."
        action={
          <Badge tone={current?.mode === "hardware" ? "blue" : "amber"}>
            {modeLabel(current)}
          </Badge>
        }
      />
      <div className="analytics-metrics">
        <Metric
          icon={Gauge}
          label="Instantaneous load"
          value={n(current?.loadPower, 2)}
          unit="W"
          helper="Current source value"
          accent="orange"
        />
        <Metric
          icon={Zap}
          label="Energy consumed"
          value={n(analytics?.loadEnergyWh, 2)}
          unit="Wh"
          helper="Selected history range"
          accent="mint"
        />
        <Metric
          icon={Activity}
          label="Peak load"
          value={n(analytics?.peakLoad, 2)}
          unit="W"
          helper="Observed sample peak"
          accent="blue"
        />
        <Metric
          icon={Gauge}
          label="Average load"
          value={n(analytics?.averageLoad, 2)}
          unit="W"
          helper="Observed sample average"
          accent="yellow"
        />
      </div>
      <div className="chart-grid">
        <ChartPanel title="Load trend" subtitle="Power · W">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="load"
                name="Load"
                stroke="#efaa69"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
        <div className="panel">
          <SectionTitle
            eyebrow="DATA QUALITY"
            title="Measured versus estimated"
          />
          <p className="technical-note">
            Load energy currently reflects the selected data source. In
            simulation it is synthetic. Live energy totals require valid,
            timestamped load voltage and current readings; missing intervals
            must remain visible.
          </p>
          <StatusRow
            label="Source"
            value={modeLabel(current)}
            tone={current?.mode === "hardware" ? "blue" : "amber"}
          />
          <StatusRow
            label="Current reading age"
            value={ago(current?.timestamp)}
            tone="slate"
          />
        </div>
      </div>
    </div>
  );
}

function ClimatePage() {
  const [latitude, setLatitude] = useState<number | null>(() => {
    const stored = localStorage.getItem("hybrid-weather-latitude");
    const saved = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(saved) && saved >= -90 && saved <= 90 ? saved : null;
  });
  const [longitude, setLongitude] = useState<number | null>(() => {
    const stored = localStorage.getItem("hybrid-weather-longitude");
    const saved = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(saved) && saved >= -180 && saved <= 180 ? saved : null;
  });
  const [weather, setWeather] = useState<Reading | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Finding your location…");
  const loadWeather = async (coordinates = { latitude, longitude }) => {
    if (
      coordinates.latitude === null ||
      coordinates.longitude === null ||
      !Number.isFinite(coordinates.latitude) ||
      coordinates.latitude < -90 ||
      coordinates.latitude > 90 ||
      !Number.isFinite(coordinates.longitude) ||
      coordinates.longitude < -180 ||
      coordinates.longitude > 180
    ) {
      setWeather(null);
      setError("Enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        latitude: String(coordinates.latitude),
        longitude: String(coordinates.longitude),
        hourly:
          "temperature_2m,cloud_cover,wind_speed_10m,precipitation_probability,shortwave_radiation",
        forecast_days: "2",
        timezone: "auto",
      });
      setWeather(await api(`/api/climate/forecast?${params}`));
      setLocationStatus(`Forecast loaded for ${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`);
    } catch (reason) {
      setWeather(null);
      setError(
        reason instanceof Error ? reason.message : "Weather data unavailable"
      );
    } finally {
      setLoading(false);
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      if (latitude !== null && longitude !== null) {
        setLocationStatus("Location is unavailable in this browser. Using your saved location.");
        void loadWeather();
        return;
      }
      setLocationStatus("This browser does not support location access. Enter coordinates below.");
      setError("Location is unavailable in this browser.");
      return;
    }
    setLocationStatus("Waiting for location permission…");
    setError("");
    navigator.geolocation.getCurrentPosition(
      position => {
        const next = {
          latitude: Number(position.coords.latitude.toFixed(4)),
          longitude: Number(position.coords.longitude.toFixed(4)),
        };
        setLatitude(next.latitude);
        setLongitude(next.longitude);
        localStorage.setItem("hybrid-weather-latitude", String(next.latitude));
        localStorage.setItem("hybrid-weather-longitude", String(next.longitude));
        setLocationStatus("Location found. Loading forecast…");
        void loadWeather(next);
      },
      reason => {
        const message = reason.code === reason.PERMISSION_DENIED
          ? "Location permission was denied. Allow it in your browser settings or enter coordinates manually."
          : reason.code === reason.TIMEOUT
            ? "Location lookup timed out. Try again or enter coordinates manually."
            : "Could not determine your location. Enter coordinates manually or retry.";
        if (latitude !== null && longitude !== null) {
          setLocationStatus(`${message} Using your saved location.`);
          void loadWeather();
        } else {
          setLocationStatus(message);
          setError(message);
        }
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 15 * 60_000 },
    );
  };

  useEffect(() => {
    useCurrentLocation();
  }, []);

  const hourlyData = weather?.hourly;
  const hourly = (hourlyData?.time || [])
    .slice(0, 24)
    .map((time: string, index: number) => ({
      label: new Date(time).toLocaleTimeString([], { hour: "2-digit" }),
      temperature: hourlyData?.temperature_2m?.[index] ?? null,
      cloud: hourlyData?.cloud_cover?.[index] ?? null,
      wind: hourlyData?.wind_speed_10m?.[index] ?? null,
      radiation: hourlyData?.shortwave_radiation?.[index] ?? null,
    }));
  return (
    <div>
      <SectionTitle
        eyebrow="CLIMATE PREDICTOR"
        title="Weather outlook"
        detail="When this page opens, your browser can use your location to fetch a local forecast. Coordinates are saved in this browser for your next visit."
        action={
          <Badge tone={weather ? "blue" : "amber"}>
            {weather ? "OPEN-METEO" : "NO WEATHER DATA"}
          </Badge>
        }
      />
      <div className="panel weather-controls">
        <label>
          Latitude
          <input
            type="number"
            min={-90}
            max={90}
            step="0.0001"
            value={latitude ?? ""}
            onChange={event => {
              const value = event.target.value === "" ? null : Number(event.target.value);
              setLatitude(value);
              if (value !== null) localStorage.setItem("hybrid-weather-latitude", String(value));
            }}
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            min={-180}
            max={180}
            step="0.0001"
            value={longitude ?? ""}
            onChange={event => {
              const value = event.target.value === "" ? null : Number(event.target.value);
              setLongitude(value);
              if (value !== null) localStorage.setItem("hybrid-weather-longitude", String(value));
            }}
          />
        </label>
        <button
          className="control-button running"
          onClick={() => void loadWeather()}
          disabled={loading}
        >
          {loading ? "Loading…" : weather ? "Refresh forecast" : "Load forecast"}
        </button>
        <button
          className="control-button"
          onClick={useCurrentLocation}
          disabled={loading}
        >
          <MapPin size={14} /> Use my location
        </button>
      </div>
      <p className="location-status" role="status">{locationStatus}</p>
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {weather ? (
        <>
          <p className="technical-note">
            Source: Open-Meteo · Updated{" "}
            {weather.current?.time
              ? new Date(weather.current.time).toLocaleString()
              : "at request"}
            . Weather may inform preliminary generation scenarios, but this
            prototype has no calibrated panel or turbine model.
          </p>
          <div className="analytics-metrics">
            <Metric
              icon={CloudSun}
              label="Temperature"
              value={n(weather.current?.temperature_2m, 1)}
              unit="°C"
              accent="yellow"
            />
            <Metric
              icon={CloudRain}
              label="Cloud cover"
              value={n(weather.current?.cloud_cover)}
              unit="%"
              accent="blue"
            />
            <Metric
              icon={Wind}
              label="Wind speed"
              value={n(weather.current?.wind_speed_10m, 1)}
              unit="km/h"
              accent="mint"
            />
            <Metric
              icon={Sun}
              label="Solar radiation"
              value={n(weather.current?.shortwave_radiation)}
              unit="W/m²"
              accent="orange"
            />
          </div>
          <div className="panel chart-panel">
            <div className="chart-head">
              <div>
                <strong>Hourly weather</strong>
                <span>Provider forecast · next 24 hours</span>
              </div>
              <CloudSun size={16} />
            </div>
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourly}>
                  <ChartAxis />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cloud"
                    name="Cloud cover %"
                    stroke="#70a7f6"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="wind"
                    name="Wind km/h"
                    stroke="#63d6a3"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <div className="panel">
          <SectionTitle
            eyebrow="WAITING FOR REQUEST"
            title="No weather data loaded"
            detail="Allow location access to fetch your local weather automatically, or enter coordinates above and load the forecast."
          />
        </div>
      )}
    </div>
  );
}

function DevicePage({ current }: { current: Reading | null }) {
  const [mapping, setMapping] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("hybrid-sensor-map") || "{}"
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [experimentLabel, setExperimentLabel] = useState("");
  const [experimentNotes, setExperimentNotes] = useState("");
  const [experiments, setExperiments] = useState<Reading[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("hybrid-experiments") || "[]") as Reading[];
    } catch {
      return [];
    }
  });
  const assign = (channel: string, value: string) => {
    const next = { ...mapping, [channel]: value };
    setMapping(next);
    localStorage.setItem("hybrid-sensor-map", JSON.stringify(next));
  };
  const saveExperiment = () => {
    if (!experimentLabel.trim()) return;
    const record = {
      label: experimentLabel.trim(),
      notes: experimentNotes.trim(),
      timestamp: Date.now(),
      mode: current?.mode || "unknown",
      solarVoltage: current?.solarVoltage ?? null,
      solarCurrent: current?.solarCurrent ?? null,
      solarPower: current?.solarPower ?? null,
      windVoltage: current?.windVoltage ?? null,
      windCurrent: current?.windCurrent ?? null,
      windPower: current?.windPower ?? null,
    };
    const next = [record, ...experiments].slice(0, 100);
    setExperiments(next);
    localStorage.setItem("hybrid-experiments", JSON.stringify(next));
    setExperimentLabel("");
    setExperimentNotes("");
  };
  const exportExperiments = () => {
    if (!experiments.length) return;
    const fields = ["timestamp", "label", "notes", "mode", "solarVoltage", "solarCurrent", "solarPower", "windVoltage", "windCurrent", "windPower"];
    const csv = [fields.join(","), ...experiments.map(row => fields.map(field => JSON.stringify(row[field] ?? "")).join(","))].join("\n");
    downloadCsv("hybrid-power-experiments.csv", csv);
  };
  return (
    <div>
      <SectionTitle
        eyebrow="DEVICE MANAGEMENT"
        title="ESP32 and sensor mapping"
        detail="Configure the intended measurement paths; this browser mapping is documentation only until firmware/device configuration is implemented."
        action={
          <Badge
            tone={
              current?.device?.connection === "connected" ? "green" : "amber"
            }
          >
            {current?.device?.connection || "UNREGISTERED"}
          </Badge>
        }
      />
      <div className="page-grid">
        <div className="panel">
          <SectionTitle
            eyebrow="INA219 CHANNELS"
            title="Measurement path assignment"
            detail="Only two INA219 modules are currently available."
          />
          <div className="mapping-grid">
            {[
              ["Solar path", "solar"],
              ["Wind generator", "wind"],
              ["Battery path", "battery"],
              ["Load path", "load"],
            ].map(([label, key]) => (
              <label key={key}>
                {label}
                <select
                  value={mapping[key] || "unassigned"}
                  onChange={event => assign(key, event.target.value)}
                >
                  <option value="unassigned">Not connected</option>
                  <option value="ina219-a" disabled={Object.entries(mapping).some(([path, source]) => path !== key && source === "ina219-a")}>INA219 A</option>
                  <option value="ina219-b" disabled={Object.entries(mapping).some(([path, source]) => path !== key && source === "ina219-b")}>INA219 B</option>
                </select>
              </label>
            ))}
          </div>
          <p className="technical-note">
            An INA219 measures only its wired bus path. It does not measure
            irradiance or wind speed. Save an experimentally verified mapping
            before interpreting live channels.
          </p>
        </div>
        <div className="panel">
          <SectionTitle
            eyebrow="CONNECTION STATUS"
            title={current?.device?.deviceId || "No device registered"}
          />
          <StatusRow
            label="Mode"
            value={modeLabel(current)}
            tone={current?.mode === "hardware" ? "blue" : "amber"}
          />
          <StatusRow
            label="Connection"
            value={current?.device?.connection || "unknown"}
            tone={
              current?.device?.connection === "connected" ? "green" : "amber"
            }
          />
          <StatusRow
            label="Last heartbeat"
            value={ago(current?.device?.lastHeartbeat)}
            tone="slate"
          />
          <StatusRow label="Firmware" value={current?.firmwareVersion || "Not reported"} tone={current?.firmwareVersion ? "blue" : "slate"} />
          <StatusRow label="INA219 A" value={current?.sensorStatus?.ina219_a === true ? "Ready" : current?.sensorStatus?.ina219_a === false ? "Unavailable" : "Not reported"} tone={current?.sensorStatus?.ina219_a === true ? "green" : "amber"} />
          <StatusRow label="INA219 B" value={current?.sensorStatus?.ina219_b === true ? "Ready" : current?.sensorStatus?.ina219_b === false ? "Unavailable" : "Not reported"} tone={current?.sensorStatus?.ina219_b === true ? "green" : "amber"} />
        </div>
      </div>
      <div className="panel experiment-panel">
        <SectionTitle eyebrow="EXPERIMENT LAB" title="Record a controlled run" detail="Measurements are stored in this browser with their original simulation/live source label." action={<button className="control-button" onClick={exportExperiments} disabled={!experiments.length}><Download size={14} /> Export log</button>} />
        <div className="experiment-form">
          <label>Experiment label<input value={experimentLabel} onChange={event => setExperimentLabel(event.target.value)} placeholder="Fan speed · setting 2" maxLength={80} /></label>
          <label>Notes<textarea value={experimentNotes} onChange={event => setExperimentNotes(event.target.value)} placeholder="Orientation, setup changes, or observations" rows={2} maxLength={500} /></label>
          <button className="control-button running" onClick={saveExperiment} disabled={!experimentLabel.trim()}>Record current sample</button>
        </div>
        {experiments.slice(0, 8).map((experiment, index) => <div className="status-row" key={`${experiment.timestamp}-${index}`}><span><strong>{experiment.label}</strong><small className="alert-source">{new Date(experiment.timestamp).toLocaleString()} · {String(experiment.mode)} · Solar {n(experiment.solarPower, 2)} W · Wind {n(experiment.windPower, 2)} W{experiment.notes ? ` · ${experiment.notes}` : ""}</small></span><Badge tone={experiment.mode === "hardware" ? "blue" : "amber"}>{String(experiment.mode).toUpperCase()}</Badge></div>)}
        {!experiments.length && <div className="empty-state">No experiments have been recorded in this browser.</div>}
      </div>
    </div>
  );
}

function AlertsPage({ alerts }: { alerts: Reading[] }) {
  return (
    <div>
      <SectionTitle
        eyebrow="ALERT CENTER"
        title="System alerts"
        detail="Advisory status from the current energy service. No electrical control is performed."
        action={
          <Badge
            tone={
              alerts.some(alert => alert.level === "CRITICAL") ? "red" : "green"
            }
          >
            {alerts.length} ACTIVE
          </Badge>
        }
      />
      <div className="panel">
        {alerts.length ? (
          alerts.map((alert, index) => (
            <div
              className="status-row"
              key={`${alert.source}-${alert.timestamp}-${index}`}
            >
              <span>
                <strong>{alert.level}</strong> · {alert.message}
                <small className="alert-source">
                  {alert.source} · {new Date(alert.timestamp).toLocaleString()}
                </small>
              </span>
              <Badge
                tone={
                  alert.level === "CRITICAL"
                    ? "red"
                    : alert.level === "WARNING"
                      ? "amber"
                      : "blue"
                }
              >
                {alert.level}
              </Badge>
            </div>
          ))
        ) : (
          <div className="empty-state">
            No alerts reported by the current data source.
          </div>
        )}
      </div>
    </div>
  );
}

function ExportPage({
  range,
  setRange,
  customRange,
  setCustomRange,
}: {
  range: string;
  setRange: (range: string) => void;
  customRange: { from: string; to: string };
  setCustomRange: React.Dispatch<React.SetStateAction<{ from: string; to: string }>>;
}) {
  const [message, setMessage] = useState("");
  const download = async () => {
    setMessage("");
    try {
      const params = new URLSearchParams({ range });
      if (range === "custom") {
        params.set("from", new Date(customRange.from).toISOString());
        params.set("to", new Date(customRange.to).toISOString());
      }
      const rows: Reading[] = [];
      let offset = 0;
      let result: Reading;
      do {
        result = await api(`/api/energy/history?${params}&limit=500&offset=${offset}`);
        rows.push(...(result.history as Reading[]));
        offset += 500;
      } while (result.truncated && offset < 100_000);
      if (!rows.length) {
        setMessage("No readings are available for this range.");
        return;
      }
      const fields = [
        "timestamp",
        "deviceId",
        "mode",
        "solarPower",
        "windPower",
        "totalGeneration",
        "loadPower",
        "batteryVoltage",
        "batteryCurrent",
        "batteryLevel",
      ];
      const csv = [
        fields.join(","),
        ...rows.map(row =>
          fields.map(field => JSON.stringify(row[field] ?? "")).join(",")
        ),
      ].join("\n");
      downloadCsv(`hybrid-power-${range}.csv`, csv);
      setMessage(
        `Exported ${rows.length} ${result.modeLabel.toLowerCase()} readings.`
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Export failed.");
    }
  };
  return (
    <div>
      <SectionTitle
        eyebrow="DATA EXPORT"
        title="Download readings"
        detail="CSV rows include their source mode and timestamp."
        action={
          <div className="export-actions">
            <RangeControls range={range} setRange={setRange} customRange={customRange} setCustomRange={setCustomRange} />
            <button className="control-button running" onClick={download}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        }
      />
      <div className="panel">
        <SectionTitle eyebrow="CURRENT RANGE" title={range.toUpperCase()} />
        <p className="technical-note">
          Exports use backend history. Sample and simulated records remain
          labeled; this application does not claim that simulated values are
          sensor readings.
        </p>
        {message && (
          <div className="status-row">
            <span>{message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ current }: { current: Reading | null }) {
  const [panelWatts, setPanelWatts] = useState(
    localStorage.getItem("hybrid-panel-watts") || ""
  );
  const [saved, setSaved] = useState(false);
  const save = () => {
    if (panelWatts && Number(panelWatts) > 0)
      localStorage.setItem("hybrid-panel-watts", panelWatts);
    else localStorage.removeItem("hybrid-panel-watts");
    setSaved(true);
  };
  return (
    <div>
      <SectionTitle
        eyebrow="SETTINGS & SYSTEM HEALTH"
        title="System configuration"
        detail="Specifications are saved in this browser and are not yet used to control hardware."
        action={<Badge tone="amber">ADVISORY ONLY</Badge>}
      />
      <div className="page-grid">
        <div className="panel">
          <SectionTitle eyebrow="SOLAR SPECIFICATION" title="Panel nameplate" />
          <label className="settings-field">
            Rated power (W)
            <input
              type="number"
              min="0"
              max="1000"
              step="1"
              value={panelWatts}
              onChange={event => {
                setPanelWatts(event.target.value);
                setSaved(false);
              }}
              placeholder="Unknown"
            />
          </label>
          <button className="control-button running" onClick={save}>
            Save specification
          </button>
          {saved && <span className="saved-note">Saved locally</span>}
          <p className="technical-note">
            Leave blank if the panel rating is not yet confirmed. INA219
            configuration must stay within its actual board and shunt limits.
          </p>
        </div>
        <div className="panel">
          <SectionTitle eyebrow="SYSTEM HEALTH" title="Service status" />
          <StatusRow
            label="Data source"
            value={modeLabel(current)}
            tone={current?.mode === "hardware" ? "blue" : "amber"}
          />
          <StatusRow
            label="Device connection"
            value={current?.device?.connection || "unknown"}
            tone={
              current?.device?.connection === "connected" ? "green" : "amber"
            }
          />
          <StatusRow
            label="Last measurement"
            value={ago(current?.timestamp)}
            tone="slate"
          />
          <StatusRow
            label="Battery nominal energy"
            value="8.88 Wh theoretical"
            tone="blue"
          />
        </div>
      </div>
    </div>
  );
}

function Overview({
  current,
  running,
  config,
  setConfig,
  postSimulator,
  toggleSimulator,
  alerts,
  healthItems,
  analytics,
  onNavigate,
}: {
  current: Reading | null;
  running: boolean;
  config: SimulatorControls;
  setConfig: React.Dispatch<React.SetStateAction<SimulatorControls>>;
  postSimulator: (payload: Record<string, number | string>) => void;
  toggleSimulator: () => void;
  alerts: Reading[];
  healthItems: readonly (readonly [
    string,
    string,
    "green" | "amber" | "red" | "blue",
  ])[];
  analytics: Reading | null;
  onNavigate: (view: string) => void;
}) {
  return (
    <div className="overview-grid">
      <div className="panel flow-panel">
        <SectionTitle
          eyebrow="ENERGY FLOW"
          title="Power path"
          detail={current?.mode === "simulator" ? "Conceptual synthetic flow; not physical power routing" : "Indicative flow; each path depends on its mapped measurement"}
          action={
            <Badge tone={current?.systemState === "DEFICIT" ? "red" : "green"}>
              {current?.systemState || "—"}
            </Badge>
          }
        />
        <div className="flow-line">
          <FlowNode
            icon={Sun}
            label="Solar"
            value={`${n(current?.solarPower)} W`}
            color="yellow"
          />
          <div className="flow-connector" />
          <FlowNode
            icon={Wind}
            label="Wind"
            value={`${n(current?.windPower)} W`}
            color="blue"
          />
          <div className="flow-connector" />
          <FlowNode
            icon={Cpu}
            label="ESP32 + API"
            value={current?.device?.connection === "offline" ? "Offline" : current?.mode === "simulator" ? "Simulation" : "Connected"}
            color="mint"
          />
          <div className="flow-connector" />
          <FlowNode
            icon={BatteryCharging}
            label="Battery"
            value={`${n(current?.batteryLevel)}%`}
            color="violet"
          />
          <div className="flow-connector" />
          <FlowNode
            icon={Zap}
            label="Load"
            value={`${n(current?.loadPower)} W`}
            color="orange"
          />
        </div>
        <div className="flow-footer">
          <div>
            <span className="muted">NET POWER</span>
            <strong className={current?.netPower < 0 ? "negative" : "positive"}>
              {current?.netPower >= 0 ? "+" : ""}
              {n(current?.netPower)} W
            </strong>
          </div>
          <div>
            <span className="muted">GENERATION COVERAGE</span>
            <strong>{n(current?.generationCoverage)}%</strong>
          </div>
          <div>
            <span className="muted">LAST READING</span>
            <strong>{ago(current?.timestamp)}</strong>
          </div>
        </div>
      </div>
      <div className="panel simulator-panel">
        <SectionTitle
          eyebrow="CONTROL ROOM"
          title="Simulator controls"
          detail="Safe demo inputs → backend state"
          action={
            <button
              className={running ? "control-button running" : "control-button"}
              onClick={toggleSimulator}
            >
              {running ? (
                <>
                  <Pause size={14} /> Pause
                </>
              ) : (
                <>
                  <Play size={14} /> Start
                </>
              )}
            </button>
          }
        />
        <div className="simulator-label">
          <span className="sim-dot" /> SIMULATOR / DEMO MODE{" "}
          <span>Values are not physical sensor readings</span>
        </div>
        <Slider
          label="Solar irradiance"
          value={config.solarIrradiance}
          min={0}
          max={1200}
          unit="W/m²"
          onChange={value =>
            setConfig(old => ({ ...old, solarIrradiance: value }))
          }
          onCommit={value => postSimulator({ solarIrradiance: value })}
        />
        <Slider
          label="Wind speed"
          value={config.windSpeed}
          min={0}
          max={20}
          step={0.1}
          unit="m/s"
          onChange={value => setConfig(old => ({ ...old, windSpeed: value }))}
          onCommit={value => postSimulator({ windSpeed: value })}
        />
        <Slider
          label="Load demand"
          value={config.loadDemand}
          min={0}
          max={8}
          unit="W"
          onChange={value => setConfig(old => ({ ...old, loadDemand: value }))}
          onCommit={value => postSimulator({ loadDemand: value })}
        />
        <Slider
          label="Initial battery state"
          value={config.batteryLevel}
          min={0}
          max={100}
          unit="%"
          onChange={value => setConfig(old => ({ ...old, batteryLevel: value }))}
          onCommit={value => postSimulator({ batteryLevel: value })}
        />
        <label className="sim-select">
          <span>Weather scenario</span>
          <select
            value={config.weatherScenario}
            onChange={event => {
              const weatherScenario = event.target.value as SimulatorControls["weatherScenario"];
              setConfig(old => ({ ...old, weatherScenario }));
              postSimulator({ weatherScenario });
            }}
          >
            <option value="clear">Clear</option>
            <option value="cloudy">Cloudy</option>
            <option value="stormy">Stormy</option>
            <option value="calm">Calm wind</option>
          </select>
        </label>
        <label className="sim-select">
          <span>Sensor fault injection</span>
          <select
            value={config.faultInjection}
            onChange={event => {
              const faultInjection = event.target.value as SimulatorControls["faultInjection"];
              setConfig(old => ({ ...old, faultInjection }));
              postSimulator({ faultInjection });
            }}
          >
            <option value="none">No fault</option>
            <option value="solar">Solar channel</option>
            <option value="wind">Wind channel</option>
            <option value="battery">Battery channel</option>
            <option value="load">Load channel</option>
            <option value="all">All channels</option>
          </select>
        </label>
      </div>
      <div className="side-stack">
        <div className="panel recommendation">
          <div className="panel-icon">
            <CircleHelp size={18} />
          </div>
          <div>
            <div className="eyebrow">SOFTWARE RECOMMENDATION</div>
            <h3>
              {current?.recommendation || "Waiting for backend telemetry…"}
            </h3>
            <p>Decision support only. No physical relays are being switched.</p>
          </div>
        </div>
        <div className="panel health-panel">
          <SectionTitle
            eyebrow="SYSTEM HEALTH"
            title="At a glance"
          />
          {healthItems.map(([label, value, tone]) => (
            <StatusRow key={label} label={label} value={value} tone={tone} />
          ))}
        </div>
        <div className="panel alerts-panel">
          <SectionTitle
            eyebrow="ALERTS"
            title={`${alerts.length} active`}
          />
          {alerts.slice(0, 2).map(alert => (
            <div className="alert-row" key={`${alert.level}-${alert.message}`}>
              <AlertTriangle
                size={15}
                className={
                  alert.level === "CRITICAL" ? "alert-red" : "alert-amber"
                }
              />
              <div>
                <strong>{alert.message}</strong>
                <small>
                  {alert.source} · {ago(alert.timestamp)}
                </small>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel mini-analytics">
        <SectionTitle
          eyebrow="BACKEND HISTORY"
          title="Generation trend"
          detail="Recorded telemetry, not frontend-generated"
          action={
            <button
              className="text-button"
              onClick={() => onNavigate("history")}
            >
              Daily history <ChevronRight size={14} />
            </button>
          }
        />
        <div className="mini-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analytics?.chart || []}>
              <defs>
                <linearGradient id="solarFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f4c95d" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f4c95d" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="windFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#70a7f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#70a7f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: "#172126",
                  border: "1px solid #2c3b40",
                  borderRadius: 12,
                  color: "#eaf1ee",
                }}
              />
              <Area
                type="monotone"
                dataKey="solar"
                stroke="#f4c95d"
                fill="url(#solarFill)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="wind"
                stroke="#70a7f6"
                fill="url(#windFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-legend">
          <span>
            <i className="legend-solar" /> Solar
          </span>
          <span>
            <i className="legend-wind" /> Wind
          </span>
          <strong>
            {n(analytics?.totalGenerationWh)} Wh <small>total</small>
          </strong>
        </div>
      </div>
    </div>
  );
}
function FlowNode({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flow-node">
      <div className={`flow-icon ${color}`}>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="slider-row">
      <div>
        <span>{label}</span>
        <strong>
          {value.toFixed(step < 1 ? 1 : 0)} <small>{unit}</small>
        </strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        onMouseUp={event =>
          onCommit(Number((event.target as HTMLInputElement).value))
        }
        onTouchEnd={event =>
          onCommit(Number((event.target as HTMLInputElement).value))
        }
        onKeyUp={event =>
          onCommit(Number((event.target as HTMLInputElement).value))
        }
      />
    </label>
  );
}

function Monitor({
  current,
  healthItems,
  pollingEnabled,
  onTogglePolling,
  onRefresh,
}: {
  current: Reading | null;
  healthItems: readonly (readonly [
    string,
    string,
    "green" | "amber" | "red" | "blue",
  ])[];
  pollingEnabled: boolean;
  onTogglePolling: () => void;
  onRefresh: () => void;
}) {
  const exportCurrent = () => {
    if (!current) return;
    const fields = ["timestamp", "deviceId", "mode", "solarVoltage", "solarCurrent", "solarPower", "windVoltage", "windCurrent", "windPower", "batteryVoltage", "batteryCurrent", "loadVoltage", "loadCurrent", "loadPower"];
    const csv = [fields.join(","), fields.map(field => JSON.stringify(current[field] ?? "")).join(",")].join("\n");
    downloadCsv(`hybrid-live-reading-${current.timestamp}.csv`, csv);
  };
  const rows = [
    ["Solar voltage", current?.solarVoltage, "V"],
    ["Solar current", current?.solarCurrent, "A"],
    ["Solar power", current?.solarPower, "W"],
    ["Wind voltage", current?.windVoltage, "V"],
    ["Wind current", current?.windCurrent, "A"],
    ["Wind power", current?.windPower, "W"],
    ["Battery voltage", current?.batteryVoltage, "V"],
    ["Battery current", current?.batteryCurrent, "A"],
    ["Battery temperature", current?.batteryTemperature, "°C"],
    ["Load voltage", current?.loadVoltage, "V"],
    ["Load current", current?.loadCurrent, "A"],
    ["Load power", current?.loadPower, "W"],
  ];
  return (
    <div className="page-grid">
      <div className="panel">
        <SectionTitle
          eyebrow="REAL-TIME MONITORING"
          title="Sensor telemetry"
          detail={`Auto-refresh ${pollingEnabled ? "on · every 2.5 seconds" : "paused"} · ${ago(current?.timestamp)}`}
          action={
            <div className="monitor-actions">
              <Badge tone={current?.mode === "hardware" ? "blue" : "amber"}>{modeLabel(current)}</Badge>
              <button className="icon-button" onClick={onRefresh} aria-label="Refresh readings" title="Refresh readings"><RefreshCw size={15} /></button>
              <button className="icon-button" onClick={onTogglePolling} aria-label={pollingEnabled ? "Pause updates" : "Resume updates"} title={pollingEnabled ? "Pause updates" : "Resume updates"}>{pollingEnabled ? <Pause size={14} /> : <Play size={14} />}</button>
              <button className="icon-button" onClick={exportCurrent} aria-label="Export current reading" title="Export current reading"><Download size={15} /></button>
            </div>
          }
        />
        <div className="sensor-grid">
          {rows.map(([label, value, unit]) => (
            <div className="sensor-cell" key={label as string}>
              <span>{label}</span>
              <strong>
                {typeof value === "number" ? `${n(value, 1)} ${unit}` : "N/A"}
              </strong>
              {value === null || value === undefined ? (
                <small>Sensor not connected</small>
              ) : (
                <small>Backend reading</small>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <SectionTitle eyebrow="IOT STATUS" title="Device connection" />
        <StatusRow
          label="Device ID"
          value={current?.device?.deviceId || "—"}
          tone="blue"
        />
        <StatusRow
          label="Connection"
          value={current?.device?.connection || "—"}
          tone={current?.device?.connection === "connected" ? "green" : "amber"}
        />
        <StatusRow
          label="Wi-Fi"
          value={current?.device?.wifi || "—"}
          tone="green"
        />
        <StatusRow
          label="Backend"
          value={current?.device?.backend || "—"}
          tone="green"
        />
        <StatusRow
          label="Data stream"
          value={current?.device?.stream || "—"}
          tone="blue"
        />
        <StatusRow
          label="Last heartbeat"
          value={ago(current?.device?.lastHeartbeat)}
          tone="slate"
        />
        <div className="health-list">
          {healthItems.map(([label, value, tone]) => (
            <StatusRow key={label} label={label} value={value} tone={tone} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RangeControls({
  range,
  setRange,
  customRange,
  setCustomRange,
}: {
  range: string;
  setRange: (range: string) => void;
  customRange: { from: string; to: string };
  setCustomRange: React.Dispatch<React.SetStateAction<{ from: string; to: string }>>;
}) {
  return (
    <div className="range-controls-wrap">
      <div className="range-toggle">
        {[["15m", "15m"], ["1h", "1h"], ["6h", "6h"], ["24h", "24h"], ["7d", "7d"], ["30d", "30d"], ["custom", "Custom"]].map(([id, label]) => (
          <button key={id} className={range === id ? "selected" : ""} onClick={() => setRange(id)}>{label}</button>
        ))}
      </div>
      {range === "custom" && (
        <div className="range-dates">
          <label>From<input type="datetime-local" value={customRange.from} onChange={event => setCustomRange(old => ({ ...old, from: event.target.value }))} /></label>
          <label>To<input type="datetime-local" value={customRange.to} onChange={event => setCustomRange(old => ({ ...old, to: event.target.value }))} /></label>
        </div>
      )}
    </div>
  );
}

function Analytics({
  data,
  range,
  setRange,
  customRange,
  setCustomRange,
  chartData,
}: {
  data: Reading | null;
  range: string;
  setRange: (range: string) => void;
  customRange: { from: string; to: string };
  setCustomRange: React.Dispatch<React.SetStateAction<{ from: string; to: string }>>;
  chartData: Reading[];
}) {
  return (
    <div>
      <SectionTitle
        eyebrow="ANALYTICS"
        title="Performance over time"
        detail="Computed from backend history with Wh/kWh-aware time integration"
        action={
          <RangeControls range={range} setRange={setRange} customRange={customRange} setCustomRange={setCustomRange} />
        }
      />
      <div className="analytics-metrics">
        <Metric
          icon={Zap}
          label="Renewable generation"
          value={n(data?.totalGenerationWh)}
          unit="Wh"
          helper={`${n(data?.solarGenerationWh)} Wh solar`}
          accent="mint"
        />
        <Metric
          icon={Sun}
          label="Solar contribution"
          value={n(data?.solarContribution)}
          unit="%"
          helper={`${n(data?.windContribution)}% wind`}
          accent="yellow"
        />
        <Metric
          icon={Gauge}
          label="Generation coverage"
          value={n(data?.generationCoverage)}
          unit="%"
          helper="Average generation / load"
          accent="violet"
        />
        <Metric
          icon={Activity}
          label="Peak generation"
          value={n(data?.peakGeneration)}
          unit="W"
          helper={`Peak load ${n(data?.peakLoad)} W`}
          accent="blue"
        />
      </div>
      <div className="chart-grid">
        <ChartPanel title="Solar vs wind" subtitle="Power output · W">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Area
                type="monotone"
                dataKey="solar"
                name="Solar"
                stroke="#f4c95d"
                fill="#f4c95d"
                fillOpacity={0.15}
              />
              <Area
                type="monotone"
                dataKey="wind"
                name="Wind"
                stroke="#70a7f6"
                fill="#70a7f6"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Generation vs load" subtitle="System balance · W">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line
                type="monotone"
                dataKey="generation"
                name="Generation"
                stroke="#63d6a3"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="load"
                name="Load"
                stroke="#f08b78"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Battery trend" subtitle="Reserve level · %">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="battery"
                name="Battery"
                stroke="#b68df4"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel
          title="Daily energy profile"
          subtitle="Recorded samples · Wh equivalent"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <ChartAxis />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Bar
                dataKey="solar"
                name="Solar"
                stackId="energy"
                fill="#f4c95d"
              />
              <Bar dataKey="wind" name="Wind" stackId="energy" fill="#70a7f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}
function ChartPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel chart-panel">
      <div className="chart-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <Activity size={16} />
      </div>
      <div className="chart-area">{children}</div>
    </div>
  );
}
function ChartAxis() {
  return (
    <>
      <CartesianGrid stroke="#26363b" strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="label"
        tick={{ fill: "#81928e", fontSize: 10 }}
        tickLine={false}
        axisLine={false}
      />
      <YAxis
        tick={{ fill: "#81928e", fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        width={30}
      />
    </>
  );
}
const tooltipStyle = {
  background: "#172126",
  border: "1px solid #2c3b40",
  borderRadius: 12,
  color: "#eaf1ee",
};

function Forecast({
  data,
  predictionData,
  current,
}: {
  data: Reading | null;
  predictionData: Reading[];
  current: Reading | null;
}) {
  const horizonEnergy = (hours: number) => {
    const values = predictionData.slice(0, hours).map(point => point.generation).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  return (
    <div>
      <SectionTitle
        eyebrow="OUTPUT PREDICTOR"
        title="Expected energy and voltage"
        detail="Local baseline estimates using recent measurements and available weather; not a trained AI model."
        action={<Badge tone={current?.mode === "hardware" ? "blue" : "amber"}>{current?.mode === "hardware" ? "LIVE-BASED ESTIMATE" : "SIMULATION SCENARIO"}</Badge>}
      />
      <div className="forecast-banner">
        <CloudSun size={22} />
        <div>
          <strong>
            {data?.method || "Historical trend + current conditions"}
          </strong>
          <span>
            {data?.sufficientHistory
              ? "Calibrated hardware history is available; forecasts remain baseline estimates."
              : "PRELIMINARY FORECAST — INSUFFICIENT CALIBRATED HISTORY"}
          </span>
        </div>
      </div>
      <div className="analytics-metrics">
        <Metric icon={Zap} label="Energy · next hour" value={n(predictionData[0]?.generation, 2)} unit={predictionData[0]?.generation == null ? "" : "Wh"} helper="One-hour baseline estimate" accent="mint" />
        <Metric icon={Sun} label="Generation · next 6 hours" value={n(horizonEnergy(6), 2)} unit="Wh" helper="Hourly points summed" accent="yellow" />
        <Metric icon={CloudSun} label="Generation · next 24 hours" value={n(horizonEnergy(24), 2)} unit="Wh" helper="Hourly points summed" accent="blue" />
        <Metric icon={Gauge} label="Demand · next hour" value={n(predictionData[0]?.load, 2)} unit="W" helper="Demand baseline" accent="orange" />
        <Metric icon={Sun} label="Solar voltage · 1h baseline" value={n(current?.solarVoltage, 2)} unit={current?.solarVoltage == null ? "" : "V"} helper={current?.solarVoltage == null ? "No mapped voltage reading" : "Latest-value persistence"} accent="yellow" />
        <Metric icon={Wind} label="Wind voltage · 1h baseline" value={n(current?.windVoltage, 2)} unit={current?.windVoltage == null ? "" : "V"} helper={current?.windVoltage == null ? "No mapped voltage reading" : "Latest-value persistence"} accent="blue" />
      </div>
      <div className="forecast-confidence">
        <StatusRow label="Model" value={data?.method || "Persistence baseline"} tone="blue" />
        <StatusRow label="Calibrated samples" value={String(data?.sampleCount ?? 0)} tone={data?.sufficientHistory ? "green" : "amber"} />
        <StatusRow label="Uncertainty" value={data?.uncertainty || "Not calibrated"} tone="amber" />
        <StatusRow label="Persistence MAE / RMSE" value={data?.evaluation ? `${n(data.evaluation.mae, 2)} / ${n(data.evaluation.rmse, 2)} W · n=${data.evaluation.sampleCount}` : "Unavailable: insufficient evaluation pairs"} tone={data?.evaluation ? "blue" : "slate"} />
      </div>
      <p className="technical-note">Voltage references above repeat the latest available sensor value; they are not weather-based voltage predictions. A reliable voltage model needs verified panel/generator specifications, electrical load behavior, and calibrated measurements. The energy forecast is shown as preliminary estimated Wh, not guaranteed production.</p>
      <div className="panel forecast-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={predictionData}>
            <ChartAxis />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar
              dataKey="solar"
              name="Solar"
              fill="#f4c95d"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="wind"
              name="Wind"
              fill="#70a7f6"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="load"
              name="Load"
              fill="#f08b78"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function Optimize({ current }: { current: Reading | null }) {
  const [scenario, setScenario] = useState({ solar: 100, wind: 100, load: 100, reserve: 20 });
  const hasSources = current?.solarPower != null && current?.windPower != null;
  const hasLoad = current?.loadPower != null;
  const scenarioGeneration = hasSources
    ? current.solarPower * scenario.solar / 100 + current.windPower * scenario.wind / 100
    : null;
  const scenarioLoad = hasLoad ? current.loadPower * scenario.load / 100 : null;
  const scenarioBalance = scenarioGeneration !== null && scenarioLoad !== null
    ? scenarioGeneration - scenarioLoad
    : null;
  const deficit = scenarioBalance !== null && scenarioBalance < 0;
  return (
    <div>
      <SectionTitle
        eyebrow="OPTIMIZATION"
        title="Energy balance & recommendations"
        detail="Advisory actions and scenario calculations never control electrical hardware."
        action={
          <Badge tone={current?.mode === "hardware" ? "blue" : "amber"}>
            {modeLabel(current)}
          </Badge>
        }
      />
      <div className="balance-row">
        <div className="balance-card">
          <span>Generation</span>
          <strong>
            {n(current?.totalGeneration)} <small>W</small>
          </strong>
          <div className="balance-bar">
            <i
              style={{
                width: `${Math.min(100, ((current?.totalGeneration || 0) / Math.max(1, current?.loadPower || 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
        <div className="balance-symbol">−</div>
        <div className="balance-card">
          <span>Load</span>
          <strong>
            {n(current?.loadPower)} <small>W</small>
          </strong>
          <div className="balance-bar load">
            <i
              style={{
                width: `${Math.min(100, ((current?.loadPower || 0) / Math.max(1, current?.totalGeneration || 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
        <div className="balance-symbol">=</div>
        <div
          className={`balance-card net ${deficit ? "negative-card" : "positive-card"}`}
        >
          <span>Net power</span>
          <strong>
            {current?.netPower != null && current.netPower >= 0 ? "+" : ""}
            {n(current?.netPower)} <small>W</small>
          </strong>
          <small>{deficit ? "Deficit" : "Surplus"}</small>
        </div>
      </div>
      <div className="opt-grid">
        <div className="panel recommendation large">
          <div className="panel-icon">
            <Settings2 size={18} />
          </div>
          <div>
            <div className="eyebrow">RECOMMENDATION</div>
            <h3>{current?.recommendation || "Waiting for live data"}</h3>
            <p>
              {deficit
                ? "Prioritize critical loads and consider reducing non-essential demand. The software can recommend actions but cannot switch physical loads without relay hardware."
                : "Recommendations are advisory. Runtime and reserve safety cannot be established until battery capacity and load paths are verified."}
            </p>
          </div>
        </div>
        <div className="panel load-panel">
          <SectionTitle eyebrow="WHAT-IF SIMULATOR" title="Adjust a scenario" detail="Scenario-only; never changes the live device or built-in simulator." />
          <Slider label="Solar output" value={scenario.solar} min={0} max={150} unit="%" onChange={value => setScenario(old => ({ ...old, solar: value }))} onCommit={() => undefined} />
          <Slider label="Wind output" value={scenario.wind} min={0} max={150} unit="%" onChange={value => setScenario(old => ({ ...old, wind: value }))} onCommit={() => undefined} />
          <Slider label="Load demand" value={scenario.load} min={50} max={200} unit="%" onChange={value => setScenario(old => ({ ...old, load: value }))} onCommit={() => undefined} />
          <Slider label="Battery reserve target" value={scenario.reserve} min={5} max={80} unit="%" onChange={value => setScenario(old => ({ ...old, reserve: value }))} onCommit={() => undefined} />
          <div className="scenario-results">
            <StatusRow label="Scenario generation" value={scenarioGeneration === null ? "Unavailable" : `${scenarioGeneration.toFixed(2)} W`} tone={scenarioGeneration === null ? "amber" : "blue"} />
            <StatusRow label="Scenario load" value={scenarioLoad === null ? "Unavailable" : `${scenarioLoad.toFixed(2)} W`} tone={scenarioLoad === null ? "amber" : "blue"} />
            <StatusRow label="Scenario balance" value={scenarioBalance === null ? "Unavailable" : `${scenarioBalance >= 0 ? "+" : ""}${scenarioBalance.toFixed(2)} W`} tone={scenarioBalance === null ? "amber" : deficit ? "red" : "green"} />
            <StatusRow label="Reserve target" value={`${scenario.reserve}% · scenario only`} tone="slate" />
          </div>
        </div>
      </div>
    </div>
  );
}
function System({
  current,
  healthItems,
}: {
  current: Reading | null;
  healthItems: readonly (readonly [
    string,
    string,
    "green" | "amber" | "red",
  ])[];
}) {
  const components = [
    [Sun, "Solar panel", "Converts irradiance into DC power."],
    [Wind, "Wind turbine", "Converts wind motion into electrical power."],
    [
      Activity,
      "Voltage + current sensors",
      "Measures electrical parameters at source and load.",
    ],
    [Cpu, "ESP32", "Reads sensors and sends validated JSON over Wi-Fi."],
    [
      BatteryCharging,
      "Charge controller",
      "Routes generation into storage and protects the battery.",
    ],
    [
      Server,
      "Express backend",
      "Calculates power, energy, analytics, forecasts and alerts.",
    ],
    [
      LayoutDashboard,
      "React dashboard",
      "Presents live state, trends and recommendations.",
    ],
    [Wifi, "Wi-Fi link", "Carries heartbeat and energy readings to the API."],
  ];
  return (
    <div>
      <SectionTitle
        eyebrow="SYSTEM COMPONENTS"
        title="Architecture you can explain"
        detail="Solar + wind → sensors → ESP32 → backend → dashboard"
        action={
          <Badge tone={current?.mode === "hardware" ? "blue" : "amber"}>
            {modeLabel(current)}
          </Badge>
        }
      />
      <div className="architecture">
        <div className="arch-flow">
          <span>SOLAR + WIND</span>
          <ChevronRight />
          <span>SENSORS</span>
          <ChevronRight />
          <span>ESP32 / Wi-Fi</span>
          <ChevronRight />
          <span>BACKEND</span>
          <ChevronRight />
          <span>HISTORY</span>
          <ChevronRight />
          <span>ANALYTICS</span>
        </div>
        <div className="component-grid">
          {components.map(([Icon, title, description]) => (
            <div className="component-card" key={title as string}>
              <div className="component-icon">
                <Icon size={19} />
              </div>
              <div>
                <strong>{title as string}</strong>
                <p>{description as string}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel status-wide">
        <SectionTitle
          eyebrow="DYNAMIC HEALTH"
          title="No static claims"
          detail="Health is derived from current readings and connection age"
        />
        {healthItems.map(([label, value, tone]) => (
          <StatusRow key={label} label={label} value={value} tone={tone} />
        ))}
      </div>
    </div>
  );
}
