import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { FileText, FileImage, Facebook, Instagram, Linkedin, ShieldCheck } from "lucide-react";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Hawelly, waraya mid — Images to PDF",
  description:
    "Convert PNG, JPG, WEBP, HEIC, GIF, BMP and SVG images into a single PDF. 100% in your browser. No uploads, no login.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A1128",
};

/* Replace the placeholder URLs below with your real profile links. */
const socials = [
  {
    name: "LinkedIn",
    href: "https://www.linkedin.com/in/mohammedyaser1?utm_source=share_via&utm_content=profile&utm_medium=member_ios",
    icon: Linkedin,
  },
  {
    name: "Facebook",
    href: "https://www.facebook.com/share/14uquPMRaki/?mibextid=wwXIfr",
    icon: Facebook,
  },
  {
    name: "Instagram",
    href: "https://www.instagram.com/m.el_behery?obrf=MWl1M3J6c3pqY2N0bQ%3D%3D&utm_source=qr",
    icon: Instagram,
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col bg-charcoal-900 font-sans text-white antialiased">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-900/80 backdrop-blur">
  <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
    <Link href="/" className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 via-slate-800 to-navy-900 border border-white/20 shadow-md text-white">
        <FileText size={18} />
      </div>
      <span className="text-lg font-bold tracking-tight sm:text-xl">
        Hawelly, waraya mid
      </span>
    </Link>
    <span className="hidden rounded-full border border-white/15 px-3 py-1 text-xs text-slate2-400 sm:inline-block">
      100% private · runs in your browser
    </span>
  </div>
</header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>

        <footer className="border-t border-white/10 bg-gradient-to-b from-charcoal-800/60 to-navy-900/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
            {/* Personal branding */}
            <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:text-left">
                <div
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy-700 to-navy-900 text-lg font-bold tracking-wide text-white ring-2 ring-white/15"
                >
                  ME
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate2-500">
                    Developed &amp; Maintained by
                  </p>
                  <p className="mt-1 text-lg font-bold tracking-tight text-white">
                    Mohammed Yaser{" "}
                 
                  </p>
                  <span className="mt-2 inline-block rounded-full border border-white/15 bg-white/5 px-3 py-0.5 text-xs font-medium text-slate2-400">
                    AI Engineer
                  </span>
                </div>
              </div>

              <ul className="flex items-center gap-3">
                {socials.map(({ name, href, icon: Icon }) => (
                  <li key={name}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${name} profile`}
                      title={name}
                      className="group flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-charcoal-900 text-slate2-400 transition duration-300 ease-out hover:-translate-y-1 hover:border-white/40 hover:bg-navy-700 hover:text-white hover:shadow-lg hover:shadow-navy-900/60 focus-visible:-translate-y-1 focus-visible:border-white/40 focus-visible:text-white focus-visible:outline-none"
                    >
                      <Icon
                        size={20}
                        className="transition-transform duration-300 group-hover:scale-110"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Copyright & privacy */}
            <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-sm text-slate2-400 sm:flex-row">
              <p>
                © {new Date().getFullYear()} Hawelly, waraya mid. All rights
                reserved.
              </p>
              <p className="inline-flex items-center gap-2">
                <ShieldCheck size={16} className="text-slate2-500" />
                Your files never leave your device.
              </p>
            </div>
          </div>
        </footer>
	<Analytics />
      </body>
    </html>
  );
}
