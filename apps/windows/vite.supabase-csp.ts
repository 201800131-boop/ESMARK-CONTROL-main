import type { Plugin } from "vite";

const CONNECT_SOURCE_TOKEN = "__ESMARK_SUPABASE_CONNECT_SRC__";

function getSupabaseConnectSources(rawUrl: string): string {
  if (!rawUrl.trim()) return "";

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }

    const websocketUrl = new URL(url.origin);
    websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${url.origin} ${websocketUrl.origin}`;
  } catch {
    throw new Error(
      "VITE_SUPABASE_URL debe ser una URL http(s) valida para generar la politica de conexion.",
    );
  }
}

export function supabaseCspPlugin(rawUrl: string): Plugin {
  const connectSources = getSupabaseConnectSources(rawUrl);

  return {
    name: "esmark-supabase-csp",
    transformIndexHtml(html) {
      return html.replace(CONNECT_SOURCE_TOKEN, connectSources);
    },
  };
}

