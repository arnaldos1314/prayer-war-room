export type PrayerVisibility = 'private' | 'public' | 'pastoral';

export type Prayer = {
  id: number;
  created_at: string;
  title: string;
  category: string;
  verse: string;
  verse_text: string;
  bible_version: string;
  long_prayer: string;
  status: string;
  special_mode: string;
  lang: 'es' | 'en';
  family_id?: string | null;
  author_name?: string;
  ai_suggestion?: string | null;
  phone_contact?: string | null;
  email?: string | null;
  visibility?: PrayerVisibility;
};

export type AISuggestion = {
  type: string;
  verse: string;
  bibleVersion: string;
  verseText: string;
  prayer: string;
};

export type NewPrayerData = {
  title: string;
  category: string;
  verse: string;
  bible_version: string;
  verse_text: string;
  long_prayer: string;
  status: string;
  special_mode: string;
  lang: 'es' | 'en';
  family_id: string | null;
  author_name: string;
  ai_suggestion: string | null;
  phone_contact: string | null;
  email: string | null;
  visibility: PrayerVisibility;
};
