import { keysFromHere } from '../utils/chapters';

const chapters = (...keys: string[]) => keys.map((key) => ({ key }));

describe('keysFromHere (ticking a chapter also ticks the ones below it)', () => {
  it('newest first: ticking a chapter includes every older chapter below it', () => {
    const shown = chapters('5', '4', '3', '2', '1');
    expect(keysFromHere(shown, '3')).toEqual(['3', '2', '1']);
  });

  it('follows what is displayed: oldest first, "below" is the newer chapters', () => {
    const shown = chapters('1', '2', '3', '4', '5');
    expect(keysFromHere(shown, '3')).toEqual(['3', '4', '5']);
  });

  it('the first row includes everything, the last row only itself', () => {
    const shown = chapters('3', '2', '1');
    expect(keysFromHere(shown, '3')).toEqual(['3', '2', '1']);
    expect(keysFromHere(shown, '1')).toEqual(['1']);
  });

  it('keeps decimal and extra chapters in the list order', () => {
    const shown = chapters('3', '2.5', '2', 'id:oneshot');
    expect(keysFromHere(shown, '2.5')).toEqual(['2.5', '2', 'id:oneshot']);
  });

  it('falls back to just the tapped chapter when it is not in the list', () => {
    expect(keysFromHere(chapters('2', '1'), '9')).toEqual(['9']);
    expect(keysFromHere([], '1')).toEqual(['1']);
  });
});
