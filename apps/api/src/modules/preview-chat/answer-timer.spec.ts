import { AnswerTimer } from './answer-timer';

function clock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('AnswerTimer', () => {
  it('reports each part and the total', () => {
    const c = clock();
    const timer = new AnswerTimer(c.now);
    const embed = timer.begin('embedMs');
    c.advance(30);
    embed();
    const prepare = timer.begin('prepareMs');
    c.advance(120);
    prepare();
    c.advance(10); // overhead between the parts
    const llm = timer.begin('llmMs');
    c.advance(900);
    llm();

    expect(timer.snapshot()).toEqual({
      embedMs: 30,
      prepareMs: 120,
      llmMs: 900,
      toolMs: 0,
      firstTokenMs: null,
      totalMs: 1060,
    });
  });

  it('adds up a part that runs more than once (several model rounds)', () => {
    const c = clock();
    const timer = new AnswerTimer(c.now);
    for (const ms of [400, 250]) {
      const end = timer.begin('llmMs');
      c.advance(ms);
      end();
      const tool = timer.begin('toolMs');
      c.advance(20);
      tool();
    }
    const snap = timer.snapshot();
    expect(snap.llmMs).toBe(650);
    expect(snap.toolMs).toBe(40);
  });

  it('counts a part once even if it is ended twice', () => {
    const c = clock();
    const timer = new AnswerTimer(c.now);
    const end = timer.begin('llmMs');
    c.advance(100);
    end();
    c.advance(100);
    end();
    expect(timer.snapshot().llmMs).toBe(100);
  });

  it('keeps only the first time the first words appeared', () => {
    const c = clock();
    const timer = new AnswerTimer(c.now);
    c.advance(700);
    timer.firstToken();
    c.advance(500);
    timer.firstToken();
    expect(timer.snapshot().firstTokenMs).toBe(700);
  });

  it('measures a step even when it fails', async () => {
    const c = clock();
    const timer = new AnswerTimer(c.now);
    await expect(
      timer.measure('prepareMs', () => {
        c.advance(80);
        return Promise.reject(new Error('db down'));
      }),
    ).rejects.toThrow('db down');
    expect(timer.snapshot().prepareMs).toBe(80);
  });
});
