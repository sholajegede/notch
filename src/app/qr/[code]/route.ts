import QRCode from "qrcode";
import { site } from "@/lib/site";

/** The QR code of a short link, as an SVG. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return new Response("Not found", { status: 404 });
  const svg = await QRCode.toString(`${site.url}/s/${code}`, { type: "svg", margin: 1, color: { dark: "#202022", light: "#ffffff" } });
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
}
