// Guided tour script. One chapter per screen, in the order an examiner works. Each stop spotlights a real
// element; `quick` stops make up the short tour. Text uses **bold** for emphasis and follows the wording
// rules used across the app (flags for examiner review; "sharply reduce", never "eliminate"; no dashes).
import type { ComponentType } from "react";
import {
  Blockchain, CertificateCheck, Compass, DocumentImport, DocumentView, Enterprise, Grid, ListChecked, Microscope,
  Network_3, Radar, Security, ViewOff,
} from "@carbon/icons-react";

export type TourStep = {
  id: string;
  el?: string;                    // CSS selector to spotlight; none = a centred card
  route?: string;                 // defaults to the chapter's route
  title: string;
  body: string;
  try?: string;                   // "Try it": something to do on the highlighted element
  why?: string;                   // "Why it matters"
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  quick?: boolean;                // part of the quick tour
  hero?: "welcome" | "finale";
};
export type Chapter = {
  id: string; title: string; blurb: string; route: string; icon: ComponentType<{ size?: number }>;
  match: (path: string) => boolean; guideKey?: string; steps: TourStep[];
};

export const CHAPTERS: Chapter[] = [
  {
    id: "start", title: "Start here", blurb: "What SAT-SA is, and how the app is laid out.", route: "/command", icon: Compass, match: () => false,
    steps: [
      { id: "welcome", hero: "welcome", quick: true, title: "Welcome to SAT-SA",
        body: "The **Supervisory Analytics Tool for SOC Assessment**. Critical Sector Entities send NCIIPC the paper trail of their Security Operations Centres: alerts, cases, workflow events, escalations and asset lists. SAT-SA reads that trail and shows where practice does not match the paperwork." },
      { id: "nav", el: "[data-tour=nav]", side: "right", align: "start", title: "Four areas, in the order you work",
        body: "**Supervise**: where to look this cycle. **Investigate**: why an entity was flagged. **Prove**: why the flags can be trusted. **Operate**: bring in a new submission." },
      { id: "offline", el: ".sa-side__foot", side: "right", align: "end", title: "Nothing leaves this machine",
        body: "SAT-SA runs fully offline: no cloud, no external calls. The run id ties every number on screen to one analysis run recorded in the audit ledger.",
        why: "Supervisory data about critical infrastructure stays on the examiner's machine." },
      { id: "help", el: ".sa-top__actions", side: "bottom", align: "end", quick: true, title: "Help is always one click away",
        body: "Reopen this tour here at any time, or tour a single page. Every page also has **How to read this page**, and every number carries a small **?** that explains it in plain words." },
    ],
  },
  {
    id: "overview", title: "Overview", blurb: "The cycle at a glance and the evidence map.", route: "/command", icon: Radar, guideKey: "command", match: (p) => p === "/command",
    steps: [
      { id: "kpis", el: ".sa-kpis--glow", side: "bottom", quick: true, title: "The cycle at a glance",
        body: "Entities assessed, entities **flagged for examiner review**, entity and tactic pairs that are blind, and findings raised. Each card opens the page behind it." },
      { id: "map", el: ".sa-where__grid > div:first-child", side: "right", quick: true, title: "The evidence map",
        body: "Every entity sits on the outer ring, grouped by sector. The findings that lead the evidence sit inside: **amber** for execution gaps (practice that looks fine on paper but is not) and **red** for negative space (evidence that should exist and is missing). A line joins each flagged entity to its strongest finding.",
        try: "Hover a finding in the inner ring to light up every entity it drives, or hover an entity to see all of its findings." },
      { id: "fdr", el: ".sa-where .sa-card__head > .sa-inline", side: "bottom", align: "end", title: "One dial controls false alarms",
        body: "The **false-alarm budget (FDR)** is the share of statistical flags allowed to be wrong. The map and the priority list redraw as you change it.",
        try: "Switch between FDR 5%, 10% and 20%." },
      { id: "prio", el: ".sa-prio", side: "left", title: "Where to start",
        body: "The flagged entities with the highest supervisory attention, each with the finding that leads its case. **Amber** means flagged on calibrated statistics; **red** means a documented fact, such as a blind tactic." },
      { id: "systemic", el: ".sa-systemic", side: "top", title: "Risk no single review would reveal",
        body: "One managed SOC provider can serve entities in several sectors. Each client may look only borderline alone, yet together they share one weakness. The SOC providers chapter shows how that is separated from ordinary variation." },
    ],
  },
  {
    id: "queue", title: "Review queue", blurb: "Ranked entities under a false-alarm budget you choose.", route: "/", icon: ListChecked, guideKey: "queue", match: (p) => p === "/",
    steps: [
      { id: "budget", el: ".sa-budget", side: "bottom", quick: true, title: "Choose how many false alarms you accept",
        body: "Statistical flags are held to the budget you pick. Beside it: how many entities are flagged, how many of those **may be false alarms**, and how many more rest on documented facts, which do not depend on the budget.",
        try: "Switch between 5%, 10% and 20% and watch the counts and tiles change.",
        why: "Statistics without a known error rate either bury examiners in false alarms or hide real weaknesses. This budget was checked on all-healthy panels." },
      { id: "waffle", el: ".sa-waffle-wrap", side: "left", title: "Every entity, one tile each",
        body: "Tiles are ordered by supervisory attention, strongest first. **Amber**: statistics. **Red**: documented fact. **Grey**: nothing stood out this cycle. Any tile opens that entity's dossier." },
      { id: "hardneg", el: ".sa-hardneg", side: "bottom", title: "Unusual is not the same as weak",
        body: "BFS-04 relies heavily on SOAR automation and PWR-06 runs a very small SOC. Both look unusual, both are healthy, and both stay unflagged: SAT-SA compares each entity with what its own case mix predicts, so being different is not a finding." },
      { id: "table", el: ".sa-card--flush:has(.sa-t--queue)", side: "top", quick: true, title: "The queue itself",
        body: "One row per entity: the strongest evidence with its effect against peers, the flag basis, the **q-value** (evidence corrected for testing every entity at once), supervisory attention and a 12-month trend. Filter by sector or search above it.",
        why: "Examiners start where the evidence is strongest instead of reading every submission end to end." },
    ],
  },
  {
    id: "sectors", title: "Sectors", blurb: "The view for NCIIPC's sector desks.", route: "/sectors", icon: Grid, guideKey: "sectors", match: (p) => p === "/sectors",
    steps: [
      { id: "sector-stats", el: ".sa-stats", side: "bottom", title: "Seven critical sectors, side by side",
        body: "How many entities are flagged across the sectors, which sectors contain an entity that is blind to a whole ATT&CK tactic, and which outsourced SOC providers span sectors." },
      { id: "sector-card", el: ".sa-sectors > :first-child", side: "right", title: "One card per sector",
        body: "The ring shows how many of the sector's entities are flagged. Below it: the findings that recur across the sector, the tactics it cannot see, and any systemic provider. The link opens that sector's queue." },
    ],
  },
  {
    id: "dossier", title: "Entity dossier", blurb: "Everything about one entity, evidence first.", route: "/entity/BFS-02", icon: Enterprise, guideKey: "entity", match: (p) => p.startsWith("/entity/"),
    steps: [
      { id: "head", el: ".sa-ph", side: "bottom", align: "start", title: "Who, and on what basis",
        body: "The entity, its sector and size, who runs its SOC and what it declares, such as 24×7 monitoring. The badge states the basis of the flag. **Examination brief** prints a self-contained brief for the examination team." },
      { id: "ekpis", el: ".sa-kpis--glow", side: "bottom", title: "Four numbers frame the case",
        body: "**Supervisory attention** ranks where to look. The **q-value** combines every calibrated test for this entity. **Findings** are split into execution gaps and negative space. **Data trust** says how far the submission itself can be relied on." },
      { id: "findings", el: "section:has(> .sa-findings)", side: "left", align: "start", quick: true, title: "Findings put the evidence first",
        body: "Each finding states what the records show against peers, and the obligation it tests, such as SEBI CSCRF or CERT-In Directions 2022. The chip on the right is its p-value, or the severity of a documented fact.",
        why: "An examiner can defend every flag with the entity's own records." },
      { id: "tabs", el: ".sa-tabs", side: "bottom", title: "Eight lenses on the same entity",
        body: "Evidence over time, monthly trends, time to close, the reality behind a 24×7 claim, the regulatory crosswalk, red-team reconciliation and ATT&CK coverage.",
        try: "Click a tab to switch lenses. The tour waits for you." },
      { id: "capability", el: ".sa-sticky > .sa-card:first-child", side: "right", title: "Where the weakness sits",
        body: "The capability profile maps the evidence onto the eight SOC capability areas of the problem statement. Further out means stronger evidence of weakness." },
    ],
  },
  {
    id: "evidence", title: "Evidence and decision", blurb: "Open a finding, check the records, decide.", route: "/entity/PWR-01?finding=EG2", icon: DocumentView, match: () => false,
    steps: [
      { id: "lede", el: ".sa-sidepanel .sa-lede", side: "left", quick: true, title: "One finding, opened",
        body: "Opening a finding shows it in one sentence, with the entity's rate against the peer median. Everything below in this drawer supports that sentence." },
      { id: "records", el: "[data-tour=records]", side: "left", title: "The exact records behind it",
        body: "The cases, alerts or events that make up the evidence, straight from the entity's own submission. A case id opens its full workflow timeline, with any near-identical notes on other cases." },
      { id: "explain", el: ".sa-sidepanel .sa-explain", side: "left", quick: true, title: "A local AI that has to show its work",
        body: "**Explain this finding** asks a small model running offline on this machine for a plain-language summary. Every claim must quote a real record and pass a verifier; rejected claims are shown. One case note here tries to instruct the AI to call the case benign: it is flagged as data and never followed.",
        try: "Press Explain this finding. Cached explanations appear at once." },
      { id: "decide", el: ".sa-sidepanel .sa-decide", side: "left", quick: true, title: "The examiner decides",
        body: "**Accept** keeps the finding for the examination, **Dismiss** needs a written reason, and **Escalate** needs a press and hold so it is never accidental. Each decision is sealed in the audit ledger.",
        why: "SAT-SA flags; people decide. Core findings never depend on the AI." },
      { id: "bunching", route: "/entity/BFS-03?finding=EG6", el: ".sa-sidepanel .sa-figure", side: "left", title: "Closures squeezed under the deadline",
        body: "Another finding from another entity. **Red** bars are closures landing just under the SLA; the **green** curve is what the same SOC would show without racing the clock. The title states how many extra closures that is." },
    ],
  },
  {
    id: "blind", title: "Blind spots", blurb: "What each SOC cannot see at all.", route: "/blindspots", icon: ViewOff, guideKey: "blind", match: (p) => p === "/blindspots",
    steps: [
      { id: "bstats", el: ".sa-stats", side: "bottom", title: "No alerts can mean safe, or blind",
        body: "SAT-SA checks each entity's declared log sources against every ATT&CK tactic. If none of them can see a tactic, silence there is blindness, not safety." },
      { id: "matrix", el: ".sa-blindgrid > .sa-card", side: "right", quick: true, title: "Covered, quiet or blind",
        body: "Rows are entities, columns are tactics. **Teal**: can see, alerts present. **Amber**: can see, but far fewer alerts than expected. **Hatched red**: cannot see at all, a documented fact.",
        try: "Click a hatched red cell." },
      { id: "bdetail", el: ".sa-blindgrid > aside", side: "left", title: "Observed, expected, and the fix",
        body: "The selected cell compares alerts observed with alerts expected from the entity's assets and peers, lists its declared log sources, and links to finding NS3, which names the sources that would restore visibility." },
    ],
  },
  {
    id: "providers", title: "SOC providers", blurb: "Systemic risk from shared managed SOCs.", route: "/providers", icon: Network_3, guideKey: "providers", match: (p) => p === "/providers",
    steps: [
      { id: "phero", el: ".sa-provhero__text", side: "right", quick: true, title: "One provider, several sectors",
        body: "This managed SOC provider serves entities across several sectors. The **provider effect** is how much worse its clients' case handling is once ordinary entity-to-entity variation is taken out, with a 90% interval and a p-value." },
      { id: "pmap", el: ".sa-hubfig", side: "left", title: "Who it touches",
        body: "Providers sit in the centre, their clients on the ring grouped by sector. Red lines lead to the clients of the risky provider.",
        try: "Hover a provider in the centre to isolate its clients." },
      { id: "forest", el: ".sa-card:has(.sa-forest)", side: "top", title: "Every provider on one scale",
        body: "Dot: estimated effect. Bar: 90% interval. Right of zero means clients do worse than other SOCs; red rows are unlikely to be chance." },
    ],
  },
  {
    id: "review", title: "Review lab", blurb: "How big is the problem, with fewer manual reviews.", route: "/review/BFS-02", icon: Microscope, guideKey: "review", match: (p) => p.startsWith("/review/"),
    steps: [
      { id: "rsteps", el: ".sa-steps", side: "bottom", align: "start", title: "How big is the problem?",
        body: "A flag says where to look. The Review lab estimates how many of an entity's closed cases were handled superficially, from a small sample an examiner labels." },
      { id: "ci", el: ".sa-cis", side: "bottom", quick: true, title: "Two intervals for the same rate",
        body: "**Grey** uses the examiner's labels alone. **Blue** (prediction-powered inference) combines the labels with the model's score on every case. It stays valid even if the model is wrong, and it is narrower for the same effort.",
        why: "Fewer manual reviews for the same confidence." },
      { id: "ractions", el: ".sa-grid--lead .sa-btns", side: "top", title: "Draw, label, read",
        body: "Draw 30 random cases (the only ones used in the estimate) and 10 priority cases. In this demo, **Simulate examiner** records verdicts from the hidden answer key so you can watch the intervals shrink.",
        try: "Press Draw sample, then Simulate examiner a few times." },
      { id: "rtable", el: ".sa-section:has(> .sa-section__head)", side: "top", title: "Blind-first labelling",
        body: "The model's score stays hidden until the examiner records a verdict, so it cannot anchor judgement. Every verdict is written to the audit ledger." },
    ],
  },
  {
    id: "redteam", title: "Red-Team Lab", blurb: "Can a SOC game its regulator?", route: "/redteam-lab", icon: Security, guideKey: "redteam", match: (p) => p === "/redteam-lab",
    steps: [
      { id: "rthead", el: ".sa-rtl-head", side: "bottom", quick: true, title: "Can a SOC game its regulator?",
        body: "We simulated weak SOCs that try to hide: delaying, drifting, cherry-picking, behaving only in audit months, dropping bad cases and padding the paper trail. Every audit policy gets the same budget of human reviews." },
      { id: "rtgrid", el: ".sa-rtl-grid > .sa-card:first-child", side: "right", title: "Who gets caught",
        body: "Each cell is the share of simulated years in which the weakness was caught within 12 months. Fixed calendars are easy to game; analytics on every submission plus a small random review floor are much harder to beat.",
        try: "Click any cell to replay one year." },
      { id: "rtreplay", el: ".sa-rtl-grid > .sa-card:last-child", side: "left", title: "One year, replayed",
        body: "The true rate, what the SOC submitted, and SAT-SA's evidence building month by month, up to the month the weakness was caught.",
        why: "It sharply reduces what gaming can hide, and shows honestly where it cannot see." },
    ],
  },
  {
    id: "validation", title: "Validation", blurb: "Why the flags can be trusted.", route: "/validation", icon: CertificateCheck, guideKey: "validation", match: (p) => p === "/validation",
    steps: [
      { id: "vkpis", el: ".sa-valkpis", side: "bottom", quick: true, title: "How we know the flags can be trusted",
        body: "Planted weaknesses found, false alarms realised against the promise, weak cases found per 100 reviews, and a result on real SOC data. **Amber** badges mark synthetic results; **teal** marks real data." },
      { id: "vtabs", el: ".sa-tabs", side: "bottom", title: "Five angles on trust",
        body: "False-alarm control, examiner effort, what it can and cannot see, results on real SOC data (Microsoft GUIDE), and running offline on a laptop." },
      { id: "vfirst", el: ".sa-rise .sa-card", side: "right", title: "The promise, checked",
        body: "On panels where every entity is healthy, any flag is a false alarm. Bars at or below the dashed line mean the false-alarm promise holds." },
    ],
  },
  {
    id: "ledger", title: "Audit ledger", blurb: "A tamper-evident record of everything.", route: "/ledger", icon: Blockchain, guideKey: "ledger", match: (p) => p === "/ledger",
    steps: [
      { id: "chain", el: ".sa-chainwrap", side: "bottom", quick: true, title: "Nothing can be quietly edited",
        body: "Every submission, analysis run, sample draw and examiner decision is appended with the SHA-256 hash of the entry before it. Change one byte anywhere and every later link breaks." },
      { id: "lactions", el: ".sa-ph__actions", side: "bottom", align: "end", title: "Check it yourself",
        body: "**Verify chain** recomputes every hash from the first entry. Hold for the **tamper demo** to edit a copy (never the real ledger) and see exactly which entry breaks.",
        try: "Press Verify chain." },
      { id: "entries", el: ".sa-section:has(> .sa-toolbar)", side: "top", title: "The full record",
        body: "Every entry with its time, actor and content. Filter by entity, event or hash." },
    ],
  },
  {
    id: "ingest", title: "Ingest", blurb: "Bring in a new submission, offline.", route: "/ingest", icon: DocumentImport, guideKey: "ingest", match: (p) => p === "/ingest",
    steps: [
      { id: "isteps", el: ".sa-steps", side: "bottom", align: "start", title: "From upload to a new analysis",
        body: "Add files, validate, commit, re-analyse, review. The whole path runs on this machine." },
      { id: "iupload", el: "section[aria-label=Upload]", side: "right", title: "Validated, never silently repaired",
        body: "Drop every file of one submission: CSV, JSON, JSON-lines, Parquet or SQLite. Vendor column names are mapped automatically, malformed files are rejected with row numbers, and each file is fingerprinted in the ledger.",
        try: "Sample submissions are in data/samples/submission (valid) and data/samples/broken." },
      { id: "iwhat", el: ".sa-grid--lead > aside", side: "left", title: "Then it re-analyses",
        body: "Hold to commit and the analysis re-runs in the background, about two to three minutes on this laptop. Examiner labels, decisions and cached explanations carry over." },
    ],
  },
  {
    id: "finish", title: "Wrap-up", blurb: "What to do next.", route: "", icon: Compass, match: () => false,
    steps: [{ id: "finale", hero: "finale", quick: true, title: "You are ready", body: "" }],
  },
];

// Chapters a page can tour on its own (PageHeader's guideKey -> chapter).
export const CHAPTER_FOR_GUIDE: Record<string, string> = Object.fromEntries(CHAPTERS.filter((c) => c.guideKey).map((c) => [c.guideKey!, c.id]));
