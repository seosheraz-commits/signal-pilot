function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// examples with Lightweight Charts series:
emaFastSeries.applyOptions({ color: css("--ema-fast") });
emaSlowSeries.applyOptions({ color: css("--ema-slow") });
entrySeries.applyOptions({ color: css("--entry") });
tpSeries.applyOptions({ color: css("--tp") });
donchianUpper.applyOptions({ color: css("--donchian") });
donchianLower.applyOptions({ color: css("--donchian") });
bbUpper.applyOptions({ color: css("--bb") });
bbLower.applyOptions({ color: css("--bb") });
supportLine.applyOptions({ color: css("--support") });
resistanceLine.applyOptions({ color: css("--resistance") });
