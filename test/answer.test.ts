import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../src/shared/answer';

const valid = {
  category: 'finance',
  question: 'What is the top bet?',
  answer: 'Banks.',
  keyPoints: ['Key **one**', '  '],
  summary: ['One', ' Two ', ''],
  confidence: 'high',
  titleDelivers: true,
  evidenceTimestamp: '1:30',
  evidenceNote: 'Names the sector',
};

describe('parseAnswer', () => {
  it('reads a full answer', () => {
    expect(parseAnswer(JSON.stringify(valid))).toEqual({
      category: 'finance',
      question: 'What is the top bet?',
      answer: 'Banks.',
      keyPoints: ['Key **one**'],
      summary: ['One', 'Two'],
      confidence: 'high',
      titleDelivers: true,
      evidence: { seconds: 90, note: 'Names the sector' },
    });
  });

  it('accepts JSON wrapped in a code fence', () => {
    expect(parseAnswer('```json\n' + JSON.stringify(valid) + '\n```')?.answer).toBe('Banks.');
  });

  it('rejects unusable output', () => {
    expect(parseAnswer('not json')).toBeNull();
    expect(parseAnswer('null')).toBeNull();
    expect(parseAnswer('{"answer":"  "}')).toBeNull();
  });

  it('falls back safely on unknown values', () => {
    const answer = parseAnswer('{"answer":"Yes","category":"weird","confidence":"sure","summary":"text"}');
    expect(answer).toMatchObject({ category: 'other', confidence: 'low', keyPoints: [], summary: [], titleDelivers: true });
  });

  it('drops a timestamp past the end of the video', () => {
    expect(parseAnswer(JSON.stringify(valid), { durationSeconds: 60 })?.evidence).toBeUndefined();
    expect(parseAnswer(JSON.stringify(valid), { durationSeconds: 120 })?.evidence?.seconds).toBe(90);
  });

  describe('checking a film or song name against the page', () => {
    const film = (name: string, category = 'movie_tv') => JSON.stringify({ ...valid, category, name, confidence: 'high' });

    it('marks a name the page does not back up as a guess, whatever confidence the model claims', () => {
      const answer = parseAnswer(film('Tees Maar Khan'), { title: 'You will not believe this scene', keywords: ['comedy'] });
      expect(answer).toMatchObject({ nameIsGuess: true, confidence: 'low' });
    });

    it.each([
      ['title', { title: 'Khiladi 786 movie scene' }],
      ['title without the space', { title: 'Khiladi786 Movie Scene' }],
      ['tags', { title: 'A scene', keywords: ['KHILADI 786'] }],
      ['description', { title: 'A scene', description: 'From the film Khiladi-786.' }],
      ['channel', { title: 'A scene', channel: 'Khiladi 786 Official' }],
    ])('trusts a name found in the %s', (_where, video) => {
      const answer = parseAnswer(film('Khiladi 786'), video);
      expect(answer?.nameIsGuess).toBeUndefined();
      expect(answer?.confidence).toBe('high');
    });

    it('works for names in other scripts', () => {
      expect(parseAnswer(film('खिलाड़ी 786'), { title: 'खिलाड़ी 786 का सीन' })?.nameIsGuess).toBeUndefined();
      expect(parseAnswer(film('खिलाड़ी 786'), { title: 'एक सीन' })?.nameIsGuess).toBe(true);
    });

    it('checks songs too, but no other kind of video', () => {
      expect(parseAnswer(film('Kalyani', 'music'), { title: 'A song' })?.nameIsGuess).toBe(true);
      expect(parseAnswer(film('Some Fund', 'finance'), { title: 'Markets' })?.nameIsGuess).toBeUndefined();
    });

    it('has nothing to check when no name is given', () => {
      expect(parseAnswer(film(''), { title: 'A scene' })?.nameIsGuess).toBeUndefined();
    });
  });

  it('drops an empty or invalid timestamp', () => {
    expect(parseAnswer(JSON.stringify({ ...valid, evidenceTimestamp: '' }))?.evidence).toBeUndefined();
    expect(parseAnswer(JSON.stringify({ ...valid, evidenceTimestamp: 'soon' }))?.evidence).toBeUndefined();
    expect(parseAnswer(JSON.stringify({ ...valid, evidenceTimestamp: '00:00' }))?.evidence).toBeUndefined();
  });
});
