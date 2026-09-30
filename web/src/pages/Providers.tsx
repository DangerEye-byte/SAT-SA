import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Enterprise, Network_3, Scales } from "@carbon/icons-react";
import { api, fmtP, pct } from "../api";
import { Badge, ErrorBox, Glow, Info, Tipped, Loading, PageHeader, Synthetic } from "../components/ui";
import { useData } from "../hooks";
import { ProviderOrbit } from "../components/Orbital";
import { useTheme } from "../theme";

const GUIDE = [
  { icon: Network_3, title: "Why providers", text: "Many CSEs outsource their SOC. A weak provider is a risk no single entity's review reveals." },
  { icon: Scales, title: "Read the effect", text: "A random-effects model separates a provider-level shift from ordinary entity-to-entity variation. The bar is a 90% interval; right of zero = worse than other SOCs." },
  { icon: Enterprise, title: "Then the clients", text: "Each client may look only borderline alone. Click one to open its dossier." },
];
const fx = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`;
const weakP = (pr: any) => pr.p_value != null && pr.p_value < 0.05;

export default function ProvidersPage() {
  const { data, error } = useData(() => api.providers(), []);
  const q = useData(() => api.queue(0.1), []);
  const [showInhouse, setShowInhouse] = useState(false);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading page label="Estimating provider effects" />;
  const mssp = data.filter((pr) => pr.provider !== "INHOUSE" && pr.effect_pp != null).sort((a, b) => b.effect_pp - a.effect_pp);
  const inhouse = data.find((pr) => pr.provider === "INHOUSE");
  const worst = mssp.filter(weakP).sort((a, b) => a.p_value - b.p_value)[0];
  return (
    <>
      <PageHeader title="SOC providers" meta={<Synthetic tip />} guideKey="providers" guide={GUIDE}
        lead="A weak managed SOC provider is a cross-sector risk. Its clients can each look only slightly worse than peers, yet together show one systemic shift." />

      {worst && (
        <section className="sa-card sa-provhero" aria-label="Systemic provider risk">
          <div className="sa-provhero__text">
            <span className="sa-inline" style={{ gap: 0 }}><Badge kind="confirmed" dot>systemic risk</Badge><Info tip={{ title: "Systemic risk", text: "Raised when the provider effect is unlikely to be chance (p < 0.05). It flags the provider itself for examiner review, not only its clients." }} /></span>
            <h2 className="sa-provhero__title"><span className="sa-mono">{worst.provider}</span> serves {worst.clients.length} CSEs across {worst.sectors.length} sectors</h2>
            <p className="sa-provhero__num"><b>{fx(worst.effect_pp)}</b> <span><Tipped text="provider effect on the likely-superficial rate" tip="providerEffect" /></span></p>
            <dl className="sa-kv">
              <dt><Tipped text="90% interval" tip="ci90" /></dt><dd className="sa-num">{worst.effect_ci90.map((x: number) => x.toFixed(1)).join(" to ")} pp</dd>
              <dt><Tipped text="p-value" tip="pvalue" /></dt><dd className="sa-mono">{fmtP(worst.p_value)}</dd>
              <dt><Tipped text="Clients' rate" tip="superficial" /></dt><dd className="sa-num">{pct(worst.rate, 1)} <span className="sa-muted">against {pct(worst.others_rate, 1)} for other SOCs</span></dd>
              <dt>Sectors</dt><dd>{worst.sectors.join(", ")}</dd>
            </dl>
            <p className="sa-helper" style={{ margin: 0 }}>Flag for examiner review of the provider, not only its clients.</p>
          </div>
          <figure className="sa-hubfig">
            {q.data ? <ProviderOrbit providers={data} entities={q.data.entities} /> : <Loading label="Placing clients" />}
            <figcaption className="sa-orb-legend"><span><i className="is-line" />provider to client</span><span><i className="is-confirmed" />client of a risky provider</span><span><i className="is-ok" />client of a sound provider</span><span><i className="is-none" />in-house SOC</span></figcaption>
            <p className="sa-helper" style={{ margin: 0 }}><Tipped text="Hover a provider to isolate its clients; click a client to open its dossier." tip={{ title: "Provider map", text: "Providers sit in the centre, their clients on the ring grouped by sector. A red provider has a provider-level effect; its lines show every client it serves. Grey dots run their own SOC." }} /></p>
          </figure>
        </section>
      )}

      <div className="sa-section">
        <section className="sa-card">
          <div className="sa-card__head"><div>
            <h2 className="sa-card__title"><Tipped text="Provider effect with 90% interval" tip={{ title: "Reading the forest plot", text: "One row per provider. The dot is its estimated effect, the bar its 90% interval. Right of zero means its clients do worse than other SOCs; red rows have p < 0.05." }} /></h2>
            <p className="sa-card__sub">Shift in clients' likely-superficial rate attributable to the provider, against every other SOC. Red = p &lt; 0.05.</p>
          </div></div>
          <Forest rows={mssp} />
        </section>
      </div>
      <div className="sa-provgrid sa-section">
        {mssp.map((pr) => <ProviderCard key={pr.provider} pr={pr} />)}
      </div>

      {inhouse && (
        <section className="sa-card sa-section">
          <button type="button" className="sa-disclose" aria-expanded={showInhouse} onClick={() => setShowInhouse(!showInhouse)}>
            <span><b>{inhouse.clients.length} in-house SOCs</b><Info tip="inhouse" /> <span className="sa-muted">form part of the reference group; rate {pct(inhouse.rate, 1)} across {inhouse.sectors.length} sectors</span></span>
            <ChevronDown size={16} style={{ transform: showInhouse ? "rotate(180deg)" : undefined, transition: "transform 200ms" }} />
          </button>
          {showInhouse && <div className="sa-chips" style={{ marginTop: "1rem" }}>
            {inhouse.clients.map((c: string) => <Link key={c} to={`/entity/${c}`} className="sa-chip">{c}</Link>)}
          </div>}
        </section>
      )}
    </>
  );
}

function Forest({ rows }: { rows: any[] }) {
  const lo = Math.min(-5, ...rows.map((r) => r.effect_ci90?.[0] ?? 0)), hi = Math.max(5, ...rows.map((r) => r.effect_ci90?.[1] ?? 0));
  const min = Math.floor(lo / 5) * 5, max = Math.ceil(hi / 5) * 5;
  const x = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const ticks = Array.from({ length: (max - min) / 5 + 1 }, (_, i) => min + i * 5);
  return (
    <div className="sa-forest" role="img" aria-label={rows.map((r) => `${r.provider} ${fx(r.effect_pp)}, 90% interval ${r.effect_ci90.map((v: number) => v.toFixed(1)).join(" to ")}`).join("; ")}>
      {rows.map((r) => (
        <div key={r.provider} className={`sa-forest__row ${weakP(r) ? "is-weak" : ""}`}>
          <div className="sa-forest__name"><span className="sa-mono">{r.provider}</span><small>{r.clients.length} clients</small></div>
          <div className="sa-forest__plot">
            <span className="sa-forest__zero" style={{ left: x(0) }} />
            <span className="sa-forest__ci" style={{ left: x(r.effect_ci90[0]), width: `calc(${x(r.effect_ci90[1])} - ${x(r.effect_ci90[0])})` }} />
            <span className="sa-forest__pt" style={{ left: x(r.effect_pp) }} />
          </div>
          <div className="sa-forest__val sa-num"><span>{fx(r.effect_pp)}</span><small className="sa-mono">p {fmtP(r.p_value)}</small></div>
        </div>
      ))}
      <div className="sa-forest__row sa-forest__axis" aria-hidden="true">
        <div />
        <div className="sa-forest__plot">{ticks.map((t) => <span key={t} style={{ left: x(t) }}>{t > 0 ? `+${t}` : t}</span>)}</div>
        <div className="sa-helper">pp</div>
      </div>
      <p className="sa-helper" style={{ margin: "0.75rem 0 0" }}>Left of zero: the provider's clients do better than other SOCs. Right of zero: worse.</p>
    </div>
  );
}

function ProviderCard({ pr }: { pr: any }) {
  const nav = useNavigate();
  const weak = weakP(pr);
  const max = Math.max(pr.others_rate, ...Object.values(pr.client_rates as Record<string, number>)) * 1.15;
  return (
    <Glow tone={weak ? "confirmed" : "accent"}>
      <div className="sa-provcard">
        <div className="sa-row">
          <h3 className="sa-h3 sa-mono">{pr.provider}</h3>
          {weak ? <Badge kind="confirmed" dot>systemic risk</Badge> : <Badge kind="ok" dot>no provider effect</Badge>}<Info tip={weak ? "providerEffect" : { title: "No provider effect", text: "Clients' rates are within ordinary entity-to-entity variation of other SOCs (p ≥ 0.05). Individual clients can still be flagged on their own evidence." }} />
          <span className="sa-spacer" /><span className="sa-helper">{pr.clients.length} clients · {pr.sectors.join(", ")}</span>
        </div>
        <div className="sa-provcard__bars">
          {Object.entries(pr.client_rates as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([c, r]) => (
            <button key={c} type="button" className="sa-provbar" onClick={() => nav(`/entity/${c}`)} title={`${c}: ${pct(r, 1)} likely-superficial`}>
              <span className="sa-mono">{c}</span>
              <span className="sa-provbar__track"><i className={r > pr.others_rate ? "is-over" : ""} style={{ inlineSize: `${(r / max) * 100}%` }} /><b style={{ left: `${(pr.others_rate / max) * 100}%` }} /></span>
              <span className="sa-num">{pct(r, 1)}</span>
            </button>
          ))}
        </div>
        <p className="sa-helper" style={{ margin: 0 }}>Bars: each client's likely-superficial rate. Marker: other SOCs, {pct(pr.others_rate, 1)}.<Info tip="superficial" /></p>
      </div>
    </Glow>
  );
}
