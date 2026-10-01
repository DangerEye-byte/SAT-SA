// Information architecture shared by the sidebar (NavTree), the mobile and landing CardNav, and the top-bar crumbs.
import { Radar as RadarIcon, Blockchain, CertificateCheck, DocumentImport, Enterprise, ListChecked, Microscope, Network_3, Security, ViewOff } from "@carbon/icons-react";
import type { NavGroup } from "./components/fx/NavTree";
import type { CardNavItem } from "./components/fx/CardNav";

export const NAV: (NavGroup & { blurb: string; tone: CardNavItem["tone"] })[] = [
  {
    label: "Supervise", blurb: "Who to examine first, and why.", tone: "accent", children: [
      { to: "/command", label: "Overview", icon: <RadarIcon size={16} />, hint: "At a glance: the entity map, priority list, findings and systemic risk" },
      { to: "/queue", label: "Review queue", icon: <ListChecked size={16} />, hint: "Entities ranked for examiner review at a known false-alarm budget" },
      { to: "/sectors", label: "Sectors", icon: <Enterprise size={16} />, hint: "Flagged entities, recurring weaknesses and blind tactics per critical sector" },
      { to: "/providers", label: "SOC providers", icon: <Network_3 size={16} />, hint: "Outsourced SOC providers whose clients share a weakness" },
    ],
  },
  {
    label: "Investigate", blurb: "What is missing, and how bad it is.", tone: "review", children: [
      { to: "/blindspots", label: "Blind spots", icon: <ViewOff size={16} />, hint: "ATT&CK tactics each entity cannot see at all" },
      { to: "/review/BFS-02", label: "Review lab", icon: <Microscope size={16} />, hint: "Blind-first case review with prediction-powered confidence intervals" },
    ],
  },
  {
    label: "Prove", blurb: "Why the numbers can be trusted.", tone: "ok", children: [
      { to: "/validation", label: "Validation", icon: <CertificateCheck size={16} />, hint: "Calibration on healthy panels and results on real SOC data (Microsoft GUIDE)" },
      { to: "/redteam-lab", label: "Red-Team Lab", icon: <Security size={16} />, hint: "Can a SOC game its regulator? Audit policies against gaming strategies" },
      { to: "/ledger", label: "Audit ledger", icon: <Blockchain size={16} />, hint: "Every run and examiner decision in a SHA-256 hash chain" },
    ],
  },
  {
    label: "Operate", blurb: "Bring in the next submission.", tone: "ai", children: [
      { to: "/ingest", label: "Ingest submission", icon: <DocumentImport size={16} />, hint: "Validate and commit a periodic submission, then re-run the analysis" },
    ],
  },
];

// Map any URL onto the nav item it belongs to.
export function navKey(path: string) {
  if (path === "/queue" || path.startsWith("/entity/")) return "/queue";
  if (path.startsWith("/review")) return "/review/BFS-02";
  return NAV.flatMap((g) => g.children).find((c) => path.startsWith(c.to))?.to ?? "";
}

export function crumbsFor(path: string): { group?: string; page: string } {
  const key = navKey(path);
  for (const g of NAV) {
    const c = g.children.find((x) => x.to === key);
    if (c) {
      if (path.startsWith("/entity/")) return { group: "Review queue", page: `Entity ${decodeURIComponent(path.split("/")[2] ?? "")}` };
      if (path.startsWith("/review/")) return { group: g.label, page: `Review lab · ${decodeURIComponent(path.split("/")[2] ?? "")}` };
      return { group: g.label, page: c.label };
    }
  }
  return { page: "Not found" };
}

export const CARD_NAV: CardNavItem[] = NAV.map((g) => ({ label: g.label, blurb: g.blurb, tone: g.tone, links: g.children.map((c) => ({ label: c.label, to: c.to, hint: c.hint })) }));
