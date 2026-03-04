// Drag and Drop manager for Dooby

const DragDrop = {
  draggedElement: null,
  draggedData: null,
  placeholder: null,

  init() {
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'drop-placeholder';
  },

  makeDraggable(element, data) {
    element.setAttribute('draggable', 'true');

    element.addEventListener('dragstart', (e) => {
      this.draggedElement = element;
      this.draggedData = data;
      element.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(data));
    });

    element.addEventListener('dragend', () => {
      element.classList.remove('dragging');
      this.draggedElement = null;
      this.draggedData = null;
      if (this.placeholder.parentNode) {
        this.placeholder.parentNode.removeChild(this.placeholder);
      }
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  },

  makeDropTarget(element, options) {
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (options.type === 'collection-body') {
        element.classList.add('drag-over');
        const afterElement = this._getDragAfterElement(element, e.clientY);
        if (afterElement) {
          element.insertBefore(this.placeholder, afterElement);
        } else {
          element.appendChild(this.placeholder);
        }
      }
    });

    element.addEventListener('dragleave', (e) => {
      if (!element.contains(e.relatedTarget)) {
        element.classList.remove('drag-over');
        if (this.placeholder.parentNode === element) {
          element.removeChild(this.placeholder);
        }
      }
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      element.classList.remove('drag-over');
      if (this.placeholder.parentNode) {
        this.placeholder.parentNode.removeChild(this.placeholder);
      }

      const data = this.draggedData;
      if (!data) return;

      if (options.onDrop) {
        const dropIndex = this._getDropIndex(element, e.clientY);
        options.onDrop(data, dropIndex);
      }
    });
  },

  _getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.tab-item:not(.dragging)')];
    let closest = null;
    let closestOffset = Number.NEGATIVE_INFINITY;

    for (const child of draggableElements) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) {
        closestOffset = offset;
        closest = child;
      }
    }
    return closest;
  },

  _getDropIndex(container, y) {
    const draggableElements = [...container.querySelectorAll('.tab-item:not(.dragging)')];
    for (let i = 0; i < draggableElements.length; i++) {
      const box = draggableElements[i].getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        return i;
      }
    }
    return draggableElements.length;
  }
};
