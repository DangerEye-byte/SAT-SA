import * as echarts from "echarts";
import { PALETTES, type Palette } from "./theme";

// ECharts themes generated from the same tokens as the CSS, so charts follow the light/dark switch.
function build(p: Palette) {
  const axis = {
    axisLine: { show: true, lineStyle: { color: p.borderStrong } },
    axisTick: { show: false },
    axisLabel: { color: p.helper, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: p.border, width: 1, type: "dashed" } },
    nameTextStyle: { color: p.helper, fontSize: 11 },
  };
  return {
    color: [p.accent, p.neutral1, p.review, p.ok, p.ai, p.confirmed, p.neutral2],
    backgroundColor: "transparent",
    textStyle: { fontFamily: "'IBM Plex Sans', system-ui, sans-serif", color: p.text2 },
    title: { textStyle: { color: p.text, fontSize: 14, fontWeight: 600 }, subtextStyle: { color: p.helper } },
    legend: { textStyle: { color: p.text2, fontSize: 12 }, icon: "roundRect", itemWidth: 10, itemHeight: 10, itemGap: 16, inactiveColor: p.neutral2 },
    tooltip: {
      backgroundColor: p.layer2, borderColor: p.borderStrong, borderWidth: 1, padding: [8, 12], textStyle: { color: p.text, fontSize: 12 },
      extraCssText: "border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.5);", axisPointer: { lineStyle: { color: p.borderStrong }, crossStyle: { color: p.borderStrong } },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    logAxis: { ...axis, axisLine: { show: false } },
    timeAxis: axis,
    line: { symbolSize: 5, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: [3, 3, 0, 0] } },
    visualMap: { textStyle: { color: p.helper } },
    graph: { lineStyle: { color: p.borderStrong }, label: { color: p.text } },
    radar: { axisName: { color: p.text2 }, splitLine: { lineStyle: { color: p.border } }, axisLine: { lineStyle: { color: p.border } }, splitArea: { show: false } },
  };
}

echarts.registerTheme("satsa-dark", build(PALETTES.dark));
echarts.registerTheme("satsa-light", build(PALETTES.light));
