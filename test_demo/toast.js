function showToast(message) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 9999;
            transition: opacity 0.3s ease;
            opacity: 0;
            pointer-events: none;
            white-space: nowrap;
        `;
        document.body.appendChild(toast);
    }
    
    toast.innerText = message;
    toast.style.opacity = '1';
    
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }
    window.toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
    }, 2000);
}

// Global visual click feedback
document.addEventListener('DOMContentLoaded', () => {
    const interactiveElements = document.querySelectorAll('button, a, .cursor-pointer');
    interactiveElements.forEach(el => {
        // Skip elements that already have opacity transitions in their classes
        if (el.className && el.className.includes('transition-opacity')) return;
        
        el.style.transition = 'opacity 0.15s ease';
        
        const addOpacity = () => { el.style.opacity = '0.5'; };
        const removeOpacity = () => { el.style.opacity = '1'; };
        
        el.addEventListener('touchstart', addOpacity, {passive: true});
        el.addEventListener('touchend', removeOpacity);
        el.addEventListener('mousedown', addOpacity);
        el.addEventListener('mouseup', removeOpacity);
        el.addEventListener('mouseleave', removeOpacity);
    });
});
