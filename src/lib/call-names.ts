/** Everyday Polish first names for the "caller" of a question shown as a phone call. */
export const CALLER_NAMES = {
  female: ["Anna", "Katarzyna", "Magdalena", "Agnieszka", "Joanna", "Monika", "Ewa", "Karolina", "Natalia", "Aleksandra", "Paulina", "Marta", "Justyna", "Beata", "Dorota", "Iwona", "Sylwia", "Patrycja", "Weronika", "Barbara"],
  male: ["Piotr", "Krzysztof", "Tomasz", "Paweł", "Marcin", "Michał", "Łukasz", "Jakub", "Adam", "Marek", "Grzegorz", "Kamil", "Rafał", "Dariusz", "Mateusz", "Bartosz", "Robert", "Wojciech", "Sebastian", "Andrzej"],
} as const;

export function randomCallerName(gender: "female" | "male", avoid?: string): string {
  const list = CALLER_NAMES[gender];
  for (let i = 0; i < 5; i++) {
    const n = list[Math.floor(Math.random() * list.length)];
    if (n !== avoid) return n;
  }
  return list[0];
}
