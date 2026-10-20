import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Flag } from './Flag';

describe('Flag', () => {
  it('draws flags from the built-in library', () => {
    const { container } = render(<Flag id="estonia" height={100} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 33 21');
    expect(svg.querySelectorAll('rect')).toHaveLength(3);
  });

  it('draws nothing for names that aren’t in the library, so a quiz or player can’t inject markup', () => {
    for (const id of ['<svg onload=alert(1)>', 'toString', '__proto__', 'constructor']) {
      expect(render(<Flag id={id} />).container.innerHTML).toBe('');
    }
  });
});
