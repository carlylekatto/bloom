import { CalendarDays } from "lucide-react";
import { AgentIntegrations } from "./AgentIntegrations";
import { t, useTranslation } from "../i18n";
import "./IntegrationsTab.css";

interface IntegrationsTabProps {
	agentAlertsEnabled: boolean;
	onToggleAgentAlerts: () => void;
}

export function IntegrationsTab({ agentAlertsEnabled, onToggleAgentAlerts }: IntegrationsTabProps) {
	useTranslation();
	return (
		<>
			<section className="integration-category" aria-labelledby="agent-integrations-title">
				<div className="integration-category-heading">
					<h2 id="agent-integrations-title">{t("integrations.agents")}</h2>
					<p>{t("integrations.agentsDescription")}</p>
				</div>
				<AgentIntegrations enabled={agentAlertsEnabled} onToggle={onToggleAgentAlerts} />
			</section>
			<section className="integration-category" aria-labelledby="calendar-integrations-title">
				<div className="integration-category-heading">
					<h2 id="calendar-integrations-title">{t("integrations.calendars")}</h2>
					<p>{t("integrations.calendarsDescription")}</p>
				</div>
				<div className="setting-group">
					<div className="integration-planned">
						<CalendarDays size={22} strokeWidth={1.5} aria-hidden="true" />
						<div>
							<strong>Google Calendar</strong>
							<p>{t("integrations.calendarPlanned")}</p>
						</div>
						<span className="integration-planned-badge">{t("integrations.planned")}</span>
					</div>
				</div>
			</section>
		</>
	);
}
