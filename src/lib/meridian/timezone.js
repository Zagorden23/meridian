// Timezone helpers. Offsets come from the IANA database via Intl — never
// hardcoded — and sunrise/sunset use a compact solar approximation clearly
// labelled as estimated.
export function utcOffsetMinutes(timezone, at = new Date()) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

export function localTime(timezone, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return null;
  }
}

export function formatOffset(minutes) {
  if (minutes == null) return null;
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${h}:${m}`;
}

// Approximate sunrise/sunset (solar noon ± hour-angle). Labelled estimated.
export function sunTimes(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((start - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const decl = -23.44 * Math.cos(rad * ((360 / 365) * (dayOfYear + 10)));
  const cosH =
    (Math.cos(rad * 90.833) - Math.sin(rad * lat) * Math.sin(rad * decl)) /
    (Math.cos(rad * lat) * Math.cos(rad * decl));
  if (cosH < -1 || cosH > 1) {
    return { sunrise: null, sunset: null, polar: cosH < -1 ? "day" : "night", estimated: true };
  }
  const h = Math.acos(cosH) / rad;
  const solarNoonUtcMin = 720 - lon * 4 - equationOfTimeMin(dayOfYear);
  return {
    sunrise: minutesToIso(start, solarNoonUtcMin - h * 4),
    sunset: minutesToIso(start, solarNoonUtcMin + h * 4),
    polar: null,
    estimated: true,
  };
}

function equationOfTimeMin(dayOfYear) {
  const b = ((2 * Math.PI) / 364) * (dayOfYear - 81);
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function minutesToIso(dayStart, minutes) {
  return new Date(dayStart + minutes * 60000).toISOString();
}

export function isDaytime(lat, lon, at = new Date()) {
  const { sunrise, sunset, polar } = sunTimes(lat, lon, at);
  if (polar === "day") return true;
  if (polar === "night") return false;
  if (!sunrise || !sunset) return null;
  const t = at.getTime();
  return t >= Date.parse(sunrise) && t <= Date.parse(sunset);
}
