'use client';

// The Director mark (package 11): the two shapes of docs/ux/handoff/11-logo/assets/director-mark.svg,
// copied as they are (64×64, currentColor), inline so it is sharp at any density and takes the
// colour of the text around it — light in the dark theme, dark in the light theme. Never orange.
// Next to the word "Director" it is decorative (hidden from screen readers); alone it gets a label.
export default function DirectorMark({ size = 22, label = null, className }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} fill="currentColor" className={className} {...a11y}>
      <path d="M12 28h40v18a10 10 0 0 1-10 10H22a10 10 0 0 1-10-10z" />
      <path transform="rotate(-16 12 27)" d="M12 17h41v10H44l5-6h-9l-5 6h-4l5-6h-9l-5 6H12z" />
    </svg>
  );
}
