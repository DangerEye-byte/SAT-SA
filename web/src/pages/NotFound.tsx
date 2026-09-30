import { useLocation } from "react-router-dom";
import { ArrowRight } from "@carbon/icons-react";
import Radar from "../components/fx/Radar";
import { Btn } from "../components/ui";
import { useTheme } from "../theme";

export default function NotFound() {
  const { pathname } = useLocation();
  const { p, mode, reduceMotion } = useTheme();
  return (
    <section className="sa-404">
      <Radar color={p.accent} backgroundColor={p.bg} lightMode={mode === "light"} brightness={0.7} scale={0.62} ringCount={8} spokeCount={8} still={reduceMotion} enableMouseInteraction={false} />
      <div className="sa-404__text">
        <p className="sa-mono sa-helper">404</p>
        <h1 className="sa-h1">Nothing on the scope at <span className="sa-mono">{pathname}</span></h1>
        <p className="sa-lead">The review queue lists every entity under supervision.</p>
        <Btn kind="primary" icon={ArrowRight} to="/">Back to the queue</Btn>
      </div>
    </section>
  );
}
