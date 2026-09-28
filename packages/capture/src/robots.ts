/**
 * Minimal robots.txt evaluation (RFC 9309 longest-match semantics) for the
 * capture user agent. Robots controls are respected, never bypassed.
 */
interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value || field === "allow") current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function toRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc.endsWith("\\$") ? `${esc.slice(0, -2)}$` : esc}`);
}

/** Returns true when `path` (path + query) may be fetched by `userAgent`. */
export function isAllowed(txt: string, userAgent: string, path: string): boolean {
  const groups = parseRobots(txt);
  const token = userAgent.toLowerCase().split("/")[0] ?? "";
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (!r.path) continue;
      if (toRegex(r.path).test(path)) {
        const len = r.path.length;
        if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
      }
    }
  }
  return best ? best.allow : true;
}
