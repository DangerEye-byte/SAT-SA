import { Link } from "react-router-dom";
import { Radar as RadarIcon } from "@carbon/icons-react";

export default function Brand({ small }: { small?: boolean }) {
  return (
    <Link to="/" className="sa-brand" aria-label="SAT-SA overview">
      <span className="sa-brand__mark"><RadarIcon size={small ? 16 : 20} /></span>
      <span><strong>SAT-SA</strong>{!small && <span>Supervisory Analytics Tool for SOC Assessment</span>}</span>
    </Link>
  );
}
