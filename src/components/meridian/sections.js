// The app's sections, in journey order: orient → plan → context → personal →
// tools. One list drives the desktop rail, the mobile bar and every title.
import {
  Compass, CloudSun, Plane, Map as MapIcon, Sparkles, Wrench, Bookmark, Bot, Settings,
} from "lucide-react";

export const MODULES = [
  { id: "explore", label: "Explore", short: "Explore", icon: Compass },
  { id: "travel", label: "Travel", short: "Travel", icon: Plane },
  { id: "weather", label: "Weather", short: "Weather", icon: CloudSun },
  { id: "maps", label: "Maps", short: "Maps", icon: MapIcon },
  { id: "discover", label: "Discover", short: "Discover", icon: Sparkles },
  { id: "ai", label: "Meridian AI", short: "AI", icon: Bot },
  { id: "personal", label: "Saved", short: "Saved", icon: Bookmark },
  { id: "tools", label: "Tools", short: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", short: "Settings", icon: Settings },
];

export const MODULE_TITLE = Object.fromEntries(MODULES.map((m) => [m.id, m.label]));
