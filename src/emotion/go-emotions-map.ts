/**
 * @file go-emotions-map.ts
 * @description Keyword lexicons for rule-based emotion detection derived from
 *   the GoEmotions taxonomy.
 *
 * ARCHITECTURE:
 *   Consumed by text-sentiment.ts to perform zero-dependency lexical emotion detection.
 *   Supports English and Indonesian keyword lists.
 *
 * PAPER BASIS:
 *   - GoEmotions: arXiv:2005.00547 — Demszky et al., fine-grained emotion dataset
 *     from Reddit comments with 27 emotion labels → mapped to 8 primary classes.
 */

import type { EmotionLabel } from "./emotion-schema.js"

/** Per-label keyword triggers for lexical scoring. */
export type EmotionLexicon = Record<EmotionLabel, readonly string[]>

/**
 * English keyword lexicon for primary emotion detection.
 * Words are lowercase and match on substring/word boundaries.
 */
export const ENGLISH_LEXICON: EmotionLexicon = {
  joy: [
    "happy", "happiness", "joy", "joyful", "excited", "great", "awesome",
    "wonderful", "love", "glad", "pleased", "thrilled", "delighted", "fantastic",
    "amazing", "perfect", "brilliant", "excellent", "celebrate", "fun",
  ],
  sadness: [
    "sad", "sadness", "unhappy", "depressed", "depression", "grief", "sorrow",
    "crying", "cry", "tears", "heartbroken", "miserable", "lonely", "hopeless",
    "disappointed", "down", "blue", "upset", "gloomy", "devastated",
  ],
  anger: [
    "angry", "anger", "furious", "rage", "annoyed", "irritated", "frustrated",
    "hate", "outraged", "mad", "livid", "infuriated", "hostile", "bitter",
    "resentful", "pissed", "disgusted", "fed up",
  ],
  fear: [
    "afraid", "fear", "scared", "terrified", "anxious", "anxiety", "nervous",
    "worried", "panic", "dread", "frightened", "phobia", "uneasy", "stressed",
    "stress", "overwhelmed", "apprehensive", "horrified",
  ],
  surprise: [
    "surprised", "surprise", "shocked", "astonished", "amazed", "unexpected",
    "unbelievable", "wow", "whoa", "incredible", "stunned", "speechless",
    "bewildered", "startled",
  ],
  disgust: [
    "disgusted", "disgust", "revolted", "repulsed", "gross", "nasty", "awful",
    "terrible", "horrible", "sick", "nauseated", "appalled", "repelled",
  ],
  neutral: [
    "okay", "ok", "fine", "alright", "whatever", "sure", "noted", "understood",
    "thanks", "thank you", "yes", "no", "maybe",
  ],
  love: [
    "love", "adore", "cherish", "affection", "caring", "warmth", "fond",
    "devoted", "passionate", "tender", "sweet", "darling",
  ],
}

/**
 * Indonesian keyword lexicon for primary emotion detection.
 */
export const INDONESIAN_LEXICON: EmotionLexicon = {
  joy: [
    "senang", "bahagia", "gembira", "suka", "riang", "ceria", "bangga",
    "puas", "girang", "antusias", "bersyukur", "terima kasih", "bagus",
    "mantap", "keren", "luar biasa", "asyik", "seru",
  ],
  sadness: [
    "sedih", "kesedihan", "menangis", "nangis", "kecewa", "galau", "down",
    "depresi", "duka", "berduka", "kehilangan", "menyesal", "putus asa",
    "hancur", "patah hati", "nelangsa",
  ],
  anger: [
    "marah", "kesal", "jengkel", "emosi", "amarah", "benci", "muak",
    "frustrasi", "sebal", "dongkol", "geram", "naik darah", "meradang",
  ],
  fear: [
    "takut", "khawatir", "cemas", "gelisah", "panik", "ngeri", "was-was",
    "gugup", "phobia", "ketakutan", "resah", "stress", "stres", "tertekan",
  ],
  surprise: [
    "kaget", "terkejut", "heran", "takjub", "tidak menyangka", "tidak percaya",
    "wow", "buset", "gila", "lho", "wah",
  ],
  disgust: [
    "jijik", "muak", "mual", "jorok", "kotor", "menjijikkan", "enak sekali tidak",
    "ampun", "geli",
  ],
  neutral: [
    "oke", "baik", "iya", "ya", "tidak", "biasa", "saja", "begini", "begitu",
    "itu", "ini", "ada", "tidak ada",
  ],
  love: [
    "cinta", "sayang", "kasih", "rindu", "peduli", "suka banget", "menyayangi",
    "mencintai", "tulus", "setia",
  ],
}

/**
 * Valence scores per emotion label (for circumplex model mapping).
 * Range: -1 (negative) to +1 (positive).
 */
export const VALENCE_MAP: Record<EmotionLabel, number> = {
  joy: 0.9,
  sadness: -0.8,
  anger: -0.7,
  fear: -0.6,
  surprise: 0.2,
  disgust: -0.75,
  neutral: 0,
  love: 0.95,
}

/**
 * Arousal scores per emotion label (activation level).
 * Range: 0 (calm) to 1 (activated).
 */
export const AROUSAL_MAP: Record<EmotionLabel, number> = {
  joy: 0.7,
  sadness: 0.3,
  anger: 0.85,
  fear: 0.8,
  surprise: 0.75,
  disgust: 0.6,
  neutral: 0.2,
  love: 0.5,
}
