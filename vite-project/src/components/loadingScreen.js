import * as THREE from 'three';

export function createLoadingManager() {
    // ── DOM overlay ───────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'loading-screen';
    Object.assign(overlay.style, {
        position:        'fixed',
        inset:           '0',
        background:      '#000000',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        zIndex:          '9999',
        transition:      'opacity 0.4s ease',
    });

    const label = document.createElement('p');
    label.textContent = 'Loading...';
    Object.assign(label.style, {
        color:      '#ffffff',
        fontFamily: 'sans-serif',
        fontSize:   '1.5rem',
        letterSpacing: '0.1em',
        margin:     '0',
    });

    overlay.appendChild(label);
    document.body.appendChild(overlay);

    // ── Manager ───────────────────────────────────────────────────────────────
    const manager = new THREE.LoadingManager();

    manager.onLoad = () => {
        // Fade out then remove
        overlay.style.opacity = '0';
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    };

    manager.onError = (url) => {
        console.error(`LoadingManager: failed to load "${url}"`);
    };

    return manager;
}