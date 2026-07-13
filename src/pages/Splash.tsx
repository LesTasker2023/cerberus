export function Splash() {
  const mottos = [
    "Attack where they are unprepared.\nAppear where they do not expect.",
    "Move swift as the wind.\nAttack like fire.",
    "Let your plans be dark as night,\nand strike like a thunderbolt.",
    "All warfare is based on deception.\nFeign weakness, then crush them.",
    "In the midst of peace,\nwe create chaos.",
    "Appear weak when strong.\nStrike without warning.",
    "We know our enemy.\nWe take everything.",
  ];

  // Randomly select a motto
  const randomMotto = mottos[Math.floor(Math.random() * mottos.length)];

  return (
    <div className="splash">
      <div className="splash__content">
        <div className="splash__stage">
          <img
            className="splash__icon splash__icon--artemis"
            src="/artemis.png"
            alt=""
          />
          <img
            className="splash__icon splash__icon--cerberus"
            src="/logo.png"
            alt=""
          />
        </div>

        <div className="splash__titles">
          <div className="splash__title splash__title--artemis">ARTEMIS</div>
          <div className="splash__title splash__title--cerberus">CERBERUS</div>
        </div>
      </div>

      <div className="splash__tag" style={{ whiteSpace: "pre-line" }}>
        {randomMotto}
      </div>
      <div className="splash__bar">
        <span className="splash__fill" />
      </div>
    </div>
  );
}
