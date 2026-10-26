import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    property string endpoint: "http://127.0.0.1:10450/api/widget/metrics"
    property string cpuText: "CPU --"
    property string ramText: "RAM --"
    property string gpuText: ""
    property string netText: "↓0B ↑0B"
    property string hostText: "Linux Resource"
    property string loadText: "Conectando..."
    property string swapText: ""
    property bool hasGpu: false

    preferredRepresentation: compactRepresentation
    toolTipMainText: hostText
    toolTipSubText: loadText + (swapText ? "\n" + swapText : "")

    function formatRate(bps) {
        if (!bps || bps < 0) return "0B";
        if (bps >= 1048576) return (bps / 1048576).toFixed(1) + "M";
        if (bps >= 1024) return Math.round(bps / 1024) + "K";
        return Math.round(bps) + "B";
    }

    function fetchMetrics() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", root.endpoint, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            if (xhr.status === 200) {
                try {
                    var d = JSON.parse(xhr.responseText);
                    var cpu = Math.round(d.cpuUsage || 0);
                    var temp = d.cpuTemp != null ? " " + Math.round(d.cpuTemp) + "°C" : "";
                    root.cpuText = "CPU " + cpu + "%" + temp;

                    var ram = d.memory && d.memory.total
                        ? Math.round((d.memory.used / d.memory.total) * 100)
                        : 0;
                    root.ramText = "RAM " + ram + "%";

                    if (d.gpu) {
                        root.hasGpu = true;
                        var gpuPct = Math.round(d.gpu.utilization != null ? d.gpu.utilization : (d.gpu.memPct || 0));
                        root.gpuText = "GPU " + gpuPct + "%";
                    } else {
                        root.hasGpu = false;
                        root.gpuText = "";
                    }

                    var rx = d.network ? d.network.rx : 0;
                    var tx = d.network ? d.network.tx : 0;
                    root.netText = "↓" + formatRate(rx) + " ↑" + formatRate(tx);

                    root.hostText = (d.hostname || "host") + " · " + (d.cpuModel || "Linux");
                    var loads = d.loadavg ? d.loadavg.map(function(l) { return Number(l).toFixed(2); }).join(" ") : "0.00";
                    root.loadText = "Load " + loads + " · " + (d.ncpu || 1) + " vCPUs";
                } catch (e) {
                    root.loadText = "Erro ao processar telemetria";
                }
            } else {
                root.cpuText = "CPU --";
                root.ramText = "RAM --";
                root.hasGpu = false;
                root.loadText = "Serviço offline (127.0.0.1:10450)";
            }
        };
        xhr.send();
    }

    Timer {
        interval: 2000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.fetchMetrics()
    }

    compactRepresentation: MouseArea {
        id: compactRoot
        implicitWidth: row.implicitWidth + 16
        implicitHeight: row.implicitHeight + 6
        hoverEnabled: true
        onClicked: root.expanded = !root.expanded

        RowLayout {
            id: row
            anchors.centerIn: parent
            spacing: 10

            PlasmaComponents.Label {
                text: root.cpuText
                font.family: "monospace"
                font.bold: true
            }
            PlasmaComponents.Label {
                text: root.ramText
                font.family: "monospace"
                font.bold: true
            }
            PlasmaComponents.Label {
                visible: root.hasGpu
                text: root.gpuText
                font.family: "monospace"
                font.bold: true
            }
            PlasmaComponents.Label {
                text: root.netText
                font.family: "monospace"
            }
        }
    }

    fullRepresentation: Item {
        Layout.preferredWidth: 320
        Layout.preferredHeight: 160

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 12
            spacing: 8

            PlasmaComponents.Label {
                text: root.hostText
                font.bold: true
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            PlasmaComponents.Label {
                text: root.cpuText + "   |   " + root.ramText + (root.hasGpu ? "   |   " + root.gpuText : "")
                font.family: "monospace"
            }

            PlasmaComponents.Label {
                text: "Rede: " + root.netText
                font.family: "monospace"
            }

            PlasmaComponents.Label {
                text: root.loadText
                opacity: 0.8
            }

            Item { Layout.fillHeight: true }

            PlasmaComponents.Button {
                text: "Abrir Aplicativo Linux Resource"
                icon.name: "utilities-system-monitor"
                Layout.fillWidth: true
                onClicked: Qt.openUrlExternally("http://127.0.0.1:10450")
            }
        }
    }
}
