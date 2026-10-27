// =====================================================================
// src/components/ManerLatime.jsx — mânerul de lățime al ferestrei
// Profesorului Virtual, pe calculator (vezi src/lib/latimePanou.js).
//
// Stă pe marginea panoului (implicit cea stângă, linia aurie): tragi spre
// stânga → fereastra se lățește, spre dreapta → se îngustează. Liniuța din
// mijloc e perechea, pe verticală, a celei de pe bara albastră de pe telefon.
// Cât tragi, un strat transparent acoperă pagina: PDF-ul și exercițiul sunt
// în iframe-uri, care altfel „fură" mișcarea mouse-ului.
// =====================================================================
// offset: cât iese mânerul în afara panoului (-7 = jumătate peste linia aurie;
// 0 = în interior — pentru ferestrele cu overflow:hidden, ca widgetul)
export default function ManerLatime({ lat, edge = 'left', top = 0, offset = -7 }) {
  if (!lat) return null;
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Lățimea ferestrei profesorului: trage spre stânga sau spre dreapta"
        aria-valuenow={lat.width} aria-valuemin={lat.min} aria-valuemax={lat.max}
        title="Trage ca să lățești sau să îngustezi fereastra · dublu-clic: mare / obișnuită"
        {...lat.handleProps}
        style={{
          position: 'absolute', top, bottom: 0, [edge]: offset, width: 14, zIndex: 30,
          cursor: 'ew-resize', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <span aria-hidden style={{
          width: 6, height: 48, borderRadius: 4,
          background: lat.dragging ? 'var(--gold, #e8b931)' : 'var(--navy, #0f2b44)',
          opacity: lat.dragging ? 1 : 0.55, boxShadow: '0 0 0 2px #fff, 0 2px 6px rgba(15,43,68,.25)',
        }} />
      </div>
      {lat.dragging && (
        <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 100001, cursor: 'ew-resize' }} />
      )}
    </>
  );
}
