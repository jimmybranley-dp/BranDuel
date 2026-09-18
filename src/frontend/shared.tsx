import type { ComponentType, ReactNode } from "react";
import {
  ArrowArcLeft,
  Bug,
  ChartBar,
  Circle,
  DiceFive,
  FlagCheckered,
  Football,
  House,
  Sword,
  Target,
  UserCircle,
  Wallet,
  type IconProps,
} from "@phosphor-icons/react";
import { useStore } from "../store";
import type { GameId, ScheduledEvent } from "../types";
import brandLogoBlue from "../assets/branduel-logo-blue.png";
import brandLogoWhite from "../assets/branduel-logo-white.png";

export type View = "home" | "match-setup" | "ratings" | "bank";

export const ICONS: Partial<Record<GameId, ComponentType<IconProps>>> = {
  smash: Sword,
  boomerang: ArrowArcLeft,
  worms: Bug,
  "mario-party": DiceFive,
  "mario-kart": FlagCheckered,
  "nfl-blitz": Football,
  billiards: Circle,
  "golden-tee": FlagCheckered,
  "mortal-kombat": Sword,
};

export const NAV: Array<{ id: View; label: string; icon: ComponentType<IconProps> }> = [
  { id: "home", label: "Home", icon: House },
  { id: "match-setup", label: "Match Setup", icon: Target },
  { id: "ratings", label: "Ratings", icon: ChartBar },
  { id: "bank", label: "Team Bank", icon: Wallet },
];

export function BrandMark({ darkSurface = false }: { darkSurface?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="BranDuel">
      {darkSurface ? <img className="brand-logo" src={brandLogoWhite} alt="BranDuel" /> : <picture>
        <source media="(prefers-color-scheme: light)" srcSet={brandLogoBlue} />
        <img className="brand-logo" src={brandLogoWhite} alt="BranDuel" />
      </picture>}
    </div>
  );
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function exportData(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function GameBadge({ gameId }: { gameId: GameId }) {
  const { state } = useStore();
  const Icon = ICONS[gameId] ?? Target;
  return (
    <span className="game-badge">
      <Icon size={18} weight="bold" />
      {state.games[gameId].shortName}
    </span>
  );
}

export function ParticipantNames({ event }: { event: ScheduledEvent }) {
  const { state } = useStore();
  if (event.format === "teams" && event.teamIds) {
    return <>{event.teamIds.map((teamId, index) => <span key={teamId}>{index > 0 && <> <span className="versus">vs</span> </>}{state.teams[teamId].name}</span>)}</>;
  }
  return <>{event.playerIds?.map((id) => state.players[id].name).join(", ")}</>;
}

export function MatchHost({ event }: { event: ScheduledEvent }) {
  const { state } = useStore();
  const hostName = state.players[event.createdBy]?.name ?? "Unknown host";
  return (
    <div className="match-host" aria-label={`Match host ${hostName}. Starts the match and submits the result.`}>
      <span>Match host</span>
      <strong>{hostName}</strong>
      <small>Starts the match and submits the result</small>
    </div>
  );
}

export function PlayerPicker() {
  const { logout, busy, pending } = useStore();
  return (
    <button className="player-picker" disabled={busy || !!pending} onClick={() => void logout()}>
      <UserCircle size={20} weight="fill" />
      Sign out
    </button>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body }: { icon: ComponentType<IconProps>; title: string; body: string }) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
