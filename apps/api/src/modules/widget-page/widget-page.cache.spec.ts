import {
  WIDGET_PAGE_MAX_ENTRIES,
  WIDGET_PAGE_TTL_MS,
  WidgetPageCache,
} from './widget-page.cache';

describe('WidgetPageCache', () => {
  let cache: WidgetPageCache;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    cache = new WidgetPageCache();
    cache.now = () => now;
  });

  it('returns a stored value until the TTL ends', () => {
    cache.set('cb_a', 'https://a.example.com', cache.generation);
    now += WIDGET_PAGE_TTL_MS - 1;
    expect(cache.get('cb_a')).toBe('https://a.example.com');
    now += 1;
    expect(cache.get('cb_a')).toBeNull();
  });

  it('forgets a chatbot when it is invalidated', () => {
    cache.set('cb_a', 'https://a.example.com', cache.generation);
    cache.set('cb_b', 'https://b.example.com', cache.generation);
    cache.invalidate('cb_a');
    expect(cache.get('cb_a')).toBeNull();
    expect(cache.get('cb_b')).toBe('https://b.example.com');
  });

  it('does not keep a value loaded while an invalidation happened', () => {
    const generation = cache.generation;
    // ...the database read is in flight while the domains change...
    cache.invalidate('cb_a');
    cache.set('cb_a', 'https://old.example.com', generation);
    expect(cache.get('cb_a')).toBeNull();
  });

  it('drops the oldest entry when full', () => {
    for (let i = 0; i < WIDGET_PAGE_MAX_ENTRIES; i++) {
      cache.set(`cb_${i}`, "'none'", cache.generation);
    }
    cache.set('cb_new', "'none'", cache.generation);
    expect(cache.size).toBe(WIDGET_PAGE_MAX_ENTRIES);
    expect(cache.get('cb_0')).toBeNull();
    expect(cache.get('cb_new')).toBe("'none'");
  });
});
