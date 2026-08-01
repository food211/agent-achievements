function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function nearestDock(bounds, workArea, threshold) {
  const candidates = [
    ["left", Math.abs(bounds.x - workArea.x)],
    ["right", Math.abs(bounds.x + bounds.width - (workArea.x + workArea.width))],
    ["top", Math.abs(bounds.y - workArea.y)],
    ["bottom", Math.abs(bounds.y + bounds.height - (workArea.y + workArea.height))]
  ].sort((a, b) => a[1] - b[1]);
  if (candidates[0][1] > threshold) return null;
  const edge = candidates[0][0];
  const offset = edge === "left" || edge === "right" ? bounds.y - workArea.y : bounds.x - workArea.x;
  return { edge, offset };
}

function calculateDockedBounds(workArea, size, dock, peek, peekSize) {
  const offset = Number.isFinite(dock?.offset) ? dock.offset : 0;
  let x = workArea.x;
  let y = workArea.y;
  if (dock.edge === "left" || dock.edge === "right") {
    y = workArea.y + clamp(offset, 0, workArea.height - size.height);
    x = dock.edge === "left"
      ? workArea.x - (peek ? size.width - peekSize : 0)
      : workArea.x + workArea.width - (peek ? peekSize : size.width);
  } else {
    x = workArea.x + clamp(offset, 0, workArea.width - size.width);
    y = dock.edge === "top"
      ? workArea.y - (peek ? size.height - peekSize : 0)
      : workArea.y + workArea.height - (peek ? peekSize : size.height);
  }
  return { x, y, width: size.width, height: size.height };
}

module.exports = { calculateDockedBounds, clamp, nearestDock };

