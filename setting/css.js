//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

window.onload = function() {
    setTimeout(function() {
        var firstLoading = document.querySelector('.loading');
        if (firstLoading) {
            firstLoading.style.transition = 'opacity 1.3s';
            firstLoading.style.opacity = 0;
            setTimeout(function() {
                if (firstLoading) {
                    firstLoading.style.display = 'none';
                }
            }, 1000);
        }
    }, 1500);

    initPowderEffect(75); 
};

document.addEventListener("settings-changed", () => {
    const status = document.getElementById("status");
    if (status) {
        status.style.opacity = 1;
        setTimeout(() => {
            status.style.opacity = 0;
        }, 3000);
    }
});

document.addEventListener("settings-loaded", () => {
    const switches = document.querySelectorAll(".switch-container");

    switches.forEach((switchContainer) => {
        const checkbox = switchContainer.querySelector("input[type='checkbox']");
        const label = switchContainer.querySelector(".switch-label");

        if (checkbox && label) { 
            if (checkbox.checked) label.classList.add("gradient-label");
            else label.classList.remove("gradient-label");

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) label.classList.add("gradient-label");
                else label.classList.remove("gradient-label");
            });
        }
    });
});

document.addEventListener("DOMContentLoaded", function() {
    const autoAttendCheckbox = document.getElementById("auto-attend");
    const attendSettingContainer = document.querySelector(".attendsetting");

    if (autoAttendCheckbox && attendSettingContainer) {
        autoAttendCheckbox.addEventListener("change", function() {
            if (autoAttendCheckbox.checked) {
                attendSettingContainer.style.display = "block";
            } else {
                attendSettingContainer.style.display = "none";
            }
        });
        if (autoAttendCheckbox.checked) {
             attendSettingContainer.style.display = "block";
        } else {
             attendSettingContainer.style.display = "none";
        }
    }
});

function getRandomRainbowColor() {
    const colors = [
        '#FF0000', '#FF7F00', '#FFFF00', '#00FF00', 
        '#0000FF', '#4B0082', '#8B00FF'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

function createPowderParticle() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) {
        return;
    }

    const particle = document.createElement('div');
    particle.classList.add('powder-particle');

    particle.style.left = Math.floor(Math.random() * window.innerWidth) + 'px';
    particle.style.backgroundColor = getRandomRainbowColor();
    
    const duration = Math.random() * 5 + 7; 
    particle.style.animationDuration = duration + 's';
    
    const drift = Math.random() * 30 + 10; 
    particle.style.setProperty('--drift-amount', drift + 'px');

    particle.style.animationDelay = (Math.random() * 5) + 's';

    canvas.appendChild(particle);

    particle.addEventListener('animationend', function() {
        this.remove();
        createPowderParticle(); 
    });
}

function initPowderEffect(numParticles) {
    const canvas = document.getElementById('particle-canvas');
    if (document.body && canvas) {
        for (let i = 0; i < numParticles; i++) {
            createPowderParticle();
        }
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            const canvasDOMContentLoaded = document.getElementById('particle-canvas');
            if (canvasDOMContentLoaded) {
                for (let i = 0; i < numParticles; i++) {
                    createPowderParticle();
                }
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const cursor = document.querySelector('.custom-cursor');

    if (cursor) {
        document.addEventListener('mousemove', (e) => {
            cursor.style.left = e.clientX + 'px';
            cursor.style.top = e.clientY + 'px';
        });

        document.addEventListener('mousedown', () => {
            cursor.classList.add('cursor-active');
        });

        document.addEventListener('mouseup', () => {
            cursor.classList.remove('cursor-active');
        });

        const interactiveElements = document.querySelectorAll(
            'a, button, input, select, .switch, .slider, .checkbox-wrapper, label[for]'
        );

        interactiveElements.forEach(el => {
            el.addEventListener('mouseenter', () => {
                cursor.classList.add('cursor-interactive');
            });
            el.addEventListener('mouseleave', () => {
                cursor.classList.remove('cursor-interactive');
            });
        });
    }
});