// Cambia los archivos y textos aquí. Las rutas son relativas a index.html.
const groupPhoto = 'assets/images/carousel/GrupalPrueba.jpg';

export const carouselSettings = { interval: 5000, duration: 850 };
export const carouselImages = [
  { id: 'grupal', src: groupPhoto, title: 'El encuentro', description: 'Panorámica · Foto grupal provisional', alt: 'Retrato grupal de jugadores de airsoft', order: 1 },
  { id: 'grupal-izquierda', src: groupPhoto, title: 'Nuestra perspectiva', description: 'Encuadre izquierdo · Foto grupal provisional', alt: 'Detalle izquierdo del retrato grupal', framing: 'left', order: 2 },
  { id: 'grupal-derecha', src: groupPhoto, title: 'El siguiente capítulo', description: 'Encuadre derecho · Foto grupal provisional', alt: 'Detalle derecho del retrato grupal', framing: 'right', order: 3 },
];
// Ejemplo de esquema (no representa un escuadrón real):
// { id, code, name, badge, photo, description, members: [{ callsign }] }
export const squads = [];
// Contenido público aprobado únicamente. No agregar información privada aquí.
// { id, type: 'photo'|'video', src, thumbnail, title, alt, callsign,
//   squad, publishedAt: '2026-10-30', approved: true }
// Una futura fuente de datos podrá devolver este mismo esquema.
export const galleryItems = [
  { id: 'grupal-provisional', type: 'photo', src: groupPhoto, title: 'Retrato grupal · Foto provisional', alt: 'Retrato grupal de jugadores de airsoft', approved: true },
];
