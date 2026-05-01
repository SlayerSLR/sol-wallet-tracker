// ECharts helpers
window.EChartUtils = {
  create(el, theme) {
    return echarts.init(el, theme || {
      backgroundColor: 'transparent',
      textStyle: { color: '#a0a0b0', fontFamily: 'monospace', fontSize: 10 },
    });
  },

  barChart(el, title, labels, values, color = '#00d4aa') {
    if (!labels || !labels.length) return;
    const chart = this.create(el);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 100, right: 20, top: 30, bottom: 20 },
      xAxis: { type: 'value', axisLabel: { color: '#888', fontSize: 9 } },
      yAxis: { type: 'category', data: labels.reverse(), axisLabel: { color: '#888', fontSize: 9 } },
      series: [{ type: 'bar', data: values.reverse(), itemStyle: { color }, barMaxWidth: 16 }],
      title: { text: title, left: 'center', textStyle: { color: '#a0a0b0', fontSize: 11, fontWeight: 'normal' } },
    });
  },

  lineChart(el, title, timestamps, values) {
    if (!timestamps || !timestamps.length) return;
    const chart = this.create(el);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 60, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: timestamps, axisLabel: { color: '#888', fontSize: 9, rotate: 45 } },
      yAxis: { type: 'value', axisLabel: { color: '#888', fontSize: 9 } },
      series: [{ type: 'line', data: values, lineStyle: { color: '#00d4aa', width: 1 }, symbol: 'none' }],
      title: { text: title, left: 'center', textStyle: { color: '#a0a0b0', fontSize: 11, fontWeight: 'normal' } },
    });
  },

  histogram(el, title, values) {
    if (!values || !values.length) return;
    const bins = 20;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const bucketWidth = range / bins;
    const counts = new Array(bins).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor((v - min) / bucketWidth), bins - 1);
      counts[idx]++;
    }
    const data = counts.map((count, i) => [min + bucketWidth * i + bucketWidth / 2, count]);
    const chart = this.create(el);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 20, top: 30, bottom: 20 },
      xAxis: { type: 'value', axisLabel: { color: '#888', fontSize: 9 } },
      yAxis: { type: 'value', axisLabel: { color: '#888', fontSize: 9 } },
      series: [{ type: 'bar', data, barMaxWidth: 8, barGap: 0, barCategoryGap: 0, itemStyle: { color: '#00d4aa' } }],
      title: { text: title, left: 'center', textStyle: { color: '#a0a0b0', fontSize: 11, fontWeight: 'normal' } },
    });
  },
};
