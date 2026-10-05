export const randomUUID = () => crypto.randomUUID();
export const randomInt = (a, b) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a)));
