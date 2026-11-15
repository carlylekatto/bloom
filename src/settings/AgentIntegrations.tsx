import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BellRing } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { AgentAlert, AgentLogo } from "../components/AgentAlert";
import { AGENT_NAMES, type Agent, type AgentAlertKind } from "../agentAlerts";
import { t, useTranslation } from "../i18n";
import "./IntegrationsTab.css";

interface Integration {
	agent: Agent;
	installed: boolean;
	needs_update: boolean;
	verified_at: number | null;
	path: string;
}
interface BridgeStatus {
	error: string | null;
	integrations: Integration[];
}

export function AgentIntegrations({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
	useTranslation();
	const [status, setStatus] = useState<BridgeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<Agent | "preview" | "">("");
	const [error, setError] = useState("");
	const [previewWidth, setPreviewWidth] = useState(264);
	const [previewAgent, setPreviewAgent] = useState<Agent>("claude");
	const [previewKind, setPreviewKind] = useState<AgentAlertKind>("working");
	const [previewActivity, setPreviewActivity] = useState("thinking");
	const [previewStarted, setPreviewStarted] = useState(Date.now);
	const [setupAgent, setSetupAgent] = useState<Agent | null>(null);
	useEffect(() => {
		let disposed = false;
		const refresh = () =>
			invoke<BridgeStatus>("agent_alert_status")
				.then((value) => {
					if (!disposed) setStatus(value);
				})
				.catch((e) => {
					if (!disposed) setError(String(e));
				});
		void refresh();
		const timer = setInterval(() => void refresh(), 3000);
		return () => {
			disposed = true;
			clearInterval(timer);
		};
	}, []);
	const configure = async (integration: Integration) => {
		setBusy(true);
		setError("");
		setMessage("");
		const installing = !integration.installed || integration.needs_update;
		try {
			await invoke("configure_agent_alert", {
				agent: integration.agent,
				install: installing
			});
			setStatus(await invoke<BridgeStatus>("agent_alert_status"));
			setSetupAgent(installing ? integration.agent : null);
			if (integration.agent === "codex" && installing) {
				setMessage("");
				await invoke("open_app", { appName: "codex://settings" });
				return;
			}
			setMessage(installing ? "" : integration.agent);
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};
	const setupIntegration = status?.integrations.find(
		(integration) => integration.installed && !integration.needs_update &&
			setupAgent === integration.agent && integration.verified_at == null
	);
	const openCodexSettings = async () => {
		try {
			await invoke("open_app", { appName: "codex://settings" });
		} catch (e) {
			setError(String(e));
		}
	};
	const test = async () => {
		setError("");
		try {
			await invoke("test_agent_alert", {
				agent: previewAgent,
				kind: previewKind,
				activity: previewKind === "working" ? previewActivity : null
			});
			setMessage("preview");
		} catch (e) {
			setError(String(e));
		}
	};
	return (
		<>
			<div className="setting-group-label">{t("agentIntegrations.group")}</div>
			<div className="setting-group">
				<SettingRow
					icon={BellRing}
					label={t("agentIntegrations.title")}
					desc={t("agentIntegrations.description")}
					divider={false}
				>
					<label className="toggle-switch">
						<input
							aria-label={t("agentIntegrations.toggleLabel")}
							type="checkbox"
							checked={enabled}
							onChange={onToggle}
						/>
						<span className="slider" />
					</label>
				</SettingRow>
			</div>
			<div className="agent-preview" aria-label={t("agentIntegrations.previewLabel")}>
				<div className="agent-preview-pill" style={{ width: `min(${previewWidth}px, 100%)` }}>
					<AgentAlert
						key={previewAgent}
						alert={{
							agent: previewAgent,
							session: "preview",
							project: "your-project",
							kind: previewKind,
							activity: previewActivity as "thinking" | "reading" | "editing" | "running" | "working",
							started: previewStarted,
							received: Date.now()
						}}
						onWidthChange={setPreviewWidth}
					/>
				</div>
				<div className="agent-preview-controls">
					<select
						aria-label={t("agentIntegrations.previewAgent")}
						value={previewAgent}
						onChange={(e) => setPreviewAgent(e.target.value as Agent)}
					>
						{Object.entries(AGENT_NAMES).map(([id, label]) => (
							<option key={id} value={id}>
								{label}
							</option>
						))}
					</select>
					<select
						aria-label={t("agentIntegrations.previewEvent")}
						value={previewKind === "working" ? previewActivity : previewKind}
						onChange={(e) => {
							const value = e.target.value;
							if (["thinking", "reading", "editing", "running", "working"].includes(value)) {
								if (previewKind !== "working") setPreviewStarted(Date.now());
								setPreviewKind("working");
								setPreviewActivity(value);
							} else setPreviewKind(value as AgentAlertKind);
						}}
					>
						<option value="thinking">{t("agentActivity.thinking")}</option>
						<option value="reading">{t("agentActivity.reading")}</option>
						<option value="editing">{t("agentActivity.editing")}</option>
						<option value="running">{t("agentActivity.running")}</option>
						<option value="working">{t("agentActivity.working")}</option>
						<option value="ready">{t("agentActivity.ready")}</option>
						<option value="attention">{t("agentActivity.attention")}</option>
						<option value="error">{t("agentActivity.error")}</option>
					</select>
					<button type="button" disabled={!enabled} onClick={() => void test()}>
						{t("agentIntegrations.test")}
					</button>
				</div>
			</div>
			<div className="setting-group-label">{t("agentIntegrations.connectGroup")}</div>
			<div className="setting-group agent-integrations">
				{status?.integrations.map((integration) => (
					<div className="agent-integration" key={integration.agent}>
						<AgentLogo agent={integration.agent} />
						<div>
							<strong>{AGENT_NAMES[integration.agent]}</strong>
							<span title={integration.path}>
								{integration.needs_update
									? integration.agent === "opencode" ? t("agentIntegrations.updateOpenCode") : t("agentIntegrations.updateActivity")
									: integration.installed
										? integration.verified_at != null
											? t("agentIntegrations.connected")
											: t("agentIntegrations.awaiting")
										: integration.agent === "opencode"
											? t("agentIntegrations.plugin")
											: integration.agent === "codex"
												? t("agentIntegrations.codexApproval")
												: t("agentIntegrations.hooks")}
							</span>
						</div>
						{integration.installed && !integration.needs_update && integration.verified_at == null && (
							<button
								type="button"
								aria-expanded={setupIntegration?.agent === integration.agent}
								onClick={() => setSetupAgent(setupIntegration?.agent === integration.agent ? null : integration.agent)}
							>
								{t("agentIntegrations.help")}
							</button>
						)}
						<button
							type="button"
							disabled={busy || !!status.error}
							onClick={() => void configure(integration)}
						>
							{integration.needs_update
								? t("agentIntegrations.update")
								: integration.installed
									? t("agentIntegrations.disconnect")
									: integration.agent === "codex"
										? t("agentIntegrations.setup")
										: t("agentIntegrations.connect")}
						</button>
					</div>
				))}
				{!status && !error && <p className="agent-integration-note">{t("agentIntegrations.loading")}</p>}
			</div>
			{setupIntegration && (
				<section className="agent-setup" aria-label={t("agentIntegrations.setupLabel", { agent: AGENT_NAMES[setupIntegration.agent] })}>
					<div className="agent-setup-heading">
						<strong>{t("agentIntegrations.verify", { agent: AGENT_NAMES[setupIntegration.agent] })}</strong>
						<span>{t("agentIntegrations.verifyDescription")}</span>
					</div>
					<ol className="agent-setup-steps">
						<li className="current">
							<span className="agent-setup-number">1</span>
							<div>
								<strong>{setupIntegration.agent === "codex" ? t("agentIntegrations.allowHooks") : t("agentIntegrations.restart", { agent: AGENT_NAMES[setupIntegration.agent] })}</strong>
								<span>{setupIntegration.agent === "codex"
									? t("agentIntegrations.reviewHooks")
									: setupIntegration.agent === "opencode"
										? t("agentIntegrations.restartOpenCode")
										: t("agentIntegrations.restartDescription")}</span>
							</div>
							{setupIntegration.agent === "codex" && (
								<button type="button" onClick={() => void openCodexSettings()}>{t("agentIntegrations.openCodex")}</button>
							)}
						</li>
						<li>
							<span className="agent-setup-number">2</span>
							<div>
								<strong>{t("agentIntegrations.sendPrompt")}</strong>
								<span>{t("agentIntegrations.watch")}</span>
							</div>
							<button type="button" onClick={() => setSetupAgent(null)}>{t("agentIntegrations.close")}</button>
						</li>
					</ol>
				</section>
			)}
			<p className="agent-integration-note">
				{t("agentIntegrations.configurationNote")}
			</p>
			<p className="agent-integration-note">
				{t("agentIntegrations.activityNote")}
			</p>
			{message && (
				<p className="agent-integration-message" role="status">
					{message === "preview" ? t("agentIntegrations.previewSent") : t("agentIntegrations.disconnected", { agent: AGENT_NAMES[message] })}
				</p>
			)}
			{(error || status?.error) && (
				<p className="agent-integration-error" role="alert">
					{error || status?.error}
				</p>
			)}
		</>
	);
}
