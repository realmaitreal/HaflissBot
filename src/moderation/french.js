const WARNING_INTROS = [
  "Wesh, j'ai capté un truc chelou",
  "Frérot, ça sent pas bon",
  "Eh doucement, là y'a un bail suspect",
  "Yo, petit stop deux secondes"
];

function pickStable(text, choices) {
  const sum = [...text].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return choices[sum % choices.length];
}

function formatFrenchWarning(result) {
  const intro = pickStable(result.summary, WARNING_INTROS);
  const details = result.reasons.join(", ");
  return `${intro}: ${details}. Calme le post deux secondes.`;
}

module.exports = { formatFrenchWarning };
