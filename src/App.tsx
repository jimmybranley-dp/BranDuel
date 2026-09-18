import { useMemo, useState } from "react";
import { Receipt, Target } from "@phosphor-icons/react";
import { useStore } from "./store";
import type { View } from "./frontend/shared";
import { BrandMark, EmptyState, SectionHeading } from "./frontend/shared";
import { LoginScreen } from "./frontend/auth";
import { Shell } from "./frontend/shell";
import { BankView } from "./frontend/bank";
import { MatchSetupPage } from "./frontend/match-setup";
import { RatingsView } from "./frontend/ratings";
import { LiveBetsView } from "./frontend/live-betting";
import { NightSummary } from "./frontend/results";
import { formatMoney } from "./engine";
import brandLogoWhite from "./assets/branduel-logo-white.png";

function HomeView({ onView, notify }: { onView: (view: View) => void; notify: (message: string) => void }) {
  const { state } = useStore();
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  if (state.gameNight?.status === "active") return <LiveBetsView notify={notify} />;
  if (state.gameNight?.status === "ended") return <NightSummary />;

  return (
    <div className="page page-enter">
      <div className="home-intro">
        <div>
          <p className="eyebrow">Your Derby wallet</p>
          <h1>{team.name}</h1>
          <p>No markets are live yet. Head to Match Setup when the room is ready to open the Derby.</p>
          <button className="secondary-button home-start" onClick={() => onView("match-setup")}><Target size={18} weight="bold" /> Go to Match Setup</button>
        </div>
        <div className="bank-hero">
          <img className="bank-hero-mark" src={brandLogoWhite} alt="" aria-hidden="true" />
          <span>{team.name}</span>
          <strong>{formatMoney(state.balances[team.id])}</strong>
          <small>Team cash</small>
        </div>
      </div>

      <section>
        <SectionHeading title="Live bets" />
        <EmptyState icon={Receipt} title="No live bets" body="Open a matchup in Match Setup and its betting market will appear here." />
      </section>
    </div>
  );
}

export function App() {
  const { playerId, sessionReady } = useStore();
  const [view, setView] = useState<View>("home");
  const [toast, setToast] = useState("");
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };
  const content = useMemo(() => {
    if (view === "home") return <HomeView onView={setView} notify={notify} />;
    if (view === "match-setup") return <MatchSetupPage notify={notify} />;
    if (view === "ratings") return <RatingsView />;
    return <BankView notify={notify} />;
  }, [view]);

  if (!sessionReady) return <div className="login-page"><BrandMark /><p>Checking your session...</p></div>;
  if (!playerId) return <LoginScreen />;
  return <Shell view={view} onView={setView} toast={toast}>{content}</Shell>;
}
