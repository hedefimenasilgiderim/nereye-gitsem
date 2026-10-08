/**
 * Sunucu hatası durumunda gösterilen şeffaf bilgi bandı.
 * Veri önceki başarılı sorgudan geliyorsa kullanıcıya "canlı değil"
 * olduğunu belirtir.
 */

export function StaleDataBanner({ label = "Sunuculara ulaşılamadı · önceki sonuçlar gösteriliyor", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`mx-4 mb-2 flex items-center gap-2 rounded-xl bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-800 shadow-sm backdrop-blur ${className}`}>
      <span>📡</span>
      <span>{label}</span>
    </div>
  );
}
