// Shared by the root layout (server) and Splash (client). Must stay a plain module: constants exported
// from a 'use client' file become client references on the server, not strings.
export const SPLASH_KEY = 'ves.splashShown'

export const SPLASH_BOOT_SCRIPT =
  `try{if(!sessionStorage.getItem('${SPLASH_KEY}'))document.documentElement.classList.add('ves-splash')}catch(e){}`
