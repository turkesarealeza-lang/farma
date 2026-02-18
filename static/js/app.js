// FarmaEstoque - Application JavaScript

document.addEventListener('DOMContentLoaded', function () {
    // Auto-dismiss alerts after 4 seconds
    const alerts = document.querySelectorAll('.alert-dismissible');
    alerts.forEach(function (alert) {
        setTimeout(function () {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
            bsAlert.close();
        }, 4000);
    });

    // Auto-calculate sale value from cost and markup
    const custoInput = document.querySelector('input[name="valor_custo"]');
    const markupInput = document.querySelector('input[name="markup"]');
    const vendaInput = document.querySelector('input[name="valor_venda"]');

    if (custoInput && markupInput && vendaInput) {
        function calcularVenda() {
            const custo = parseFloat(custoInput.value.replace(',', '.')) || 0;
            const markup = parseFloat(markupInput.value.replace(',', '.')) || 0;
            if (custo > 0 && markup > 0) {
                const venda = custo * (1 + markup / 100);
                vendaInput.value = venda.toFixed(4);
            }
        }

        custoInput.addEventListener('change', calcularVenda);
        markupInput.addEventListener('change', calcularVenda);
    }

    // Update U.E. display in form
    const ueSelect = document.querySelector('select[name="unidade_estoque"]');
    const ueDisplay = document.getElementById('ue-display');
    if (ueSelect && ueDisplay) {
        ueSelect.addEventListener('change', function () {
            ueDisplay.textContent = this.value;
        });
    }
});
