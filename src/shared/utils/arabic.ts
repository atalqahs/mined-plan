/**
 * Arabic-aware text normalisation for search: removes tashkeel and tatweel,
 * unifies alef/hamza forms, taa marbuta and alef maqsura, and folds Arabic-Indic digits.
 */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ALEF = /[آأإٱ]/g; // آ أ إ ٱ -> ا
const ARABIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

export function normalizeArabic(input: string): string {
  return input
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(ALEF, 'ا')
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
