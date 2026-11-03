import Converter from "@/components/Converter";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
          Turn your images into one PDF
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-slate2-400 sm:text-lg">
          PNG, JPG, WEBP, HEIC, GIF, BMP and SVG. Reorder, rotate, tweak the
          page settings, and download.
        </p>
      </section>

      <section
        id="converter"
        className="rounded-2xl border border-white/10 bg-charcoal-800/70 p-4 shadow-xl sm:p-8"
      >
        <Converter />
      </section>
    </div>
  );
}
