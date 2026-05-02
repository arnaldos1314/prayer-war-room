import { Prayer } from '../types/prayer';

export type TrendInsight = {
  topArea: string;
  topAreaCount: number;
  crisisCount: number;
  newThisWeek: number;
  weeklyTrend: string;
  recommendations: string[];
  pastoralVerse: string;
  pastoralVerseText: string;
};

export async function analyzeTrends(
  prayers: Prayer[],
  lang: 'es' | 'en'
): Promise<TrendInsight> {
  const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY!;

  // Construimos un resumen compacto para no saturar el contexto
  const summary = prayers.map(p => ({
    cat: p.category,
    mode: p.special_mode,
    title: p.title.slice(0, 60),
    days: Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000),
  }));

  const langInstruction = lang === 'es'
    ? 'Responde en ESPAÑOL. Versículo de Biblia NTV.'
    : 'Respond in ENGLISH. Verse from NLT Bible.';

  const prompt = `Eres Victoria, asesora espiritual del Pastor. Analiza estas ${prayers.length} peticiones activas de la congregación y genera un informe pastoral estratégico.

Peticiones (resumen):
${JSON.stringify(summary, null, 2)}

${langInstruction}

Identifica:
1. El área con más peticiones esta semana
2. Cuántas son crisis (mode: urgent o categoría Salud)
3. Cuántas son nuevas (menos de 7 días)
4. Una tendencia o patrón preocupante observado
5. Tres recomendaciones concretas para el Pastor
6. Un versículo de aliento para el Pastor como líder

Responde ÚNICAMENTE con este JSON exacto, sin texto antes ni después:
{
  "topArea": "nombre de la categoría dominante",
  "topAreaCount": número,
  "crisisCount": número,
  "newThisWeek": número,
  "weeklyTrend": "descripción breve del patrón observado (max 120 chars)",
  "recommendations": ["rec1", "rec2", "rec3"],
  "pastoralVerse": "Referencia bíblica",
  "pastoralVerseText": "Texto completo del versículo"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (data.error) {
    console.error('[Victoria Pastoral] error.type:', data.error.type);
    console.error('[Victoria Pastoral] error.message:', data.error.message);
    throw new Error(data.error.message);
  }

  const rawText = data.content[0].text;
  const jsonString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
  return JSON.parse(jsonString) as TrendInsight;
}
