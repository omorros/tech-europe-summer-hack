import type { Metadata, Viewport } from "next";
import { Archivo, Courier_Prime } from "next/font/google";
import "./globals.css";

const stamp = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-stamp",
  display: "swap",
});

const record = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-record",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lantern: know the building before you go through the door",
  description:
    "Turns a live 999 call into a building briefing before the crew arrives.",
};

export const viewport: Viewport = {
  themeColor: "#12151a",
};

const CONTRACT = `
THESIS: The console is not a dashboard watching an incident — it IS the incident
record, writing itself. Refuses the glowing slate grid of equal status cards.
OWN-WORLD: A true-white printed roll on near-black steel. Sprocket margin,
timestamps, one monospace record size and one huge condensed size, no middle.
Square corners, reversed stamp bars, deep voids instead of card chrome. Red
reports incident state; hi-vis yellow reports the operator's own actions;
nothing else is coloured.
STORY: A 999 call arrives, prints itself, and the building assembles around it —
outside, then inside, then the way in.
FIRST VIEWPORT: Roll left floor-to-ceiling, transcript striking from carbon to
ink with entities stamped inline in red; address huge across the header;
attachments pinned right into the dark; stage rail bottom right.
FORM: The Incident Log — fire control teleprinter roll. Candidate 5 of 7. Seed 14f187c3.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${stamp.variable} ${record.variable}`}>
      <body>
        <div dangerouslySetInnerHTML={{ __html: `<!--${CONTRACT}-->` }} />
        {children}
      </body>
    </html>
  );
}
