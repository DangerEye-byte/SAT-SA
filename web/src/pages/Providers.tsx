import { Link } from "react-router-dom";
import { api, fmtP, pct } from "../api";
import { Chart, ErrorBox, Loading } from "../components/ui";
import { useData } from "../hooks";

export default function ProvidersPage() {
  const { data, error } = useData(() => api.providers(), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  const nodes: any[] = [], links: any[] = [];
  data.forEach((p) => {
    if (p.provider === "INHOUSE") return;
    const weak = p.p_value != null && p.p_value < 0.05;
    nodes.push({ name: p.provider, symbolSize: 40, itemStyle: { color: weak ? "#f06a6a" : "#60a5fa" }, label: { show: true } });
    Object.entries(p.client_rates).forEach(([c, r]: any) => {
      nodes.push({ name: c, symbolSize: 14 + r * 60, itemStyle: { color: weak ? "#f5b544" : "#3b5b85" }, label: { show: true, fontSize: 10 } });
      links.push({ source: p.provider, target: c });
    });
  });
  return (
    <>
      <h1>Providers — systemic risk lens</h1>
      <p className="sub">Many CSEs outsource their SOC. A weak managed provider is a cross-sector risk that no single entity's review reveals.
        A random-effects model separates a provider-level shift from ordinary entity-to-entity variation, so a provider whose clients are
        each only slightly worse is still visible as one systemic risk.</p>
      <div className="grid g2">
        <div className="card">
          <Chart height={420} option={{ series: [{ type: "graph", layout: "force", roam: true, force: { repulsion: 180, edgeLength: 70 }, data: nodes, links, lineStyle: { color: "#3b4d6b" } }] }} />
        </div>
        <div className="card">
          <table>
            <thead><tr><th>Provider</th><th>Clients</th><th>Sectors</th><th>Likely-superficial rate</th><th>vs others</th><th>Provider effect (90% CI)</th><th>p</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.provider}>
                <td><b>{p.provider}</b></td><td>{p.clients.map((c: string) => <Link key={c} to={`/entity/${c}`} style={{ marginRight: 6 }}>{c}</Link>)}</td>
                <td>{p.sectors.join(", ")}</td><td>{pct(p.rate, 1)}</td><td className="muted">{pct(p.others_rate, 1)}</td>
                <td>{p.effect_pp == null ? "—" : <>{p.effect_pp > 0 ? "+" : ""}{p.effect_pp.toFixed(1)} pp <span className="muted">({p.effect_ci90?.map((x: number) => x.toFixed(1)).join(" to ")})</span></>}</td>
                <td className={p.p_value != null && p.p_value < 0.05 ? "bad mono" : "mono"}>{fmtP(p.p_value)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
