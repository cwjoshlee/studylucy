export function StarBunny() {
  return (
    <figure className="star-bunny" role="img" aria-label="별토끼 마법 친구">
      <div className="star-bunny__picture" aria-hidden="true">
        <span className="star-bunny__ear star-bunny__ear--left" />
        <span className="star-bunny__ear star-bunny__ear--right" />
        <span className="star-bunny__face" />
        <span className="star-bunny__cape" />
        <span className="star-bunny__wand">★</span>
      </div>
      <figcaption>별토끼가 오늘의 마법 학습을 응원해요.</figcaption>
    </figure>
  );
}
