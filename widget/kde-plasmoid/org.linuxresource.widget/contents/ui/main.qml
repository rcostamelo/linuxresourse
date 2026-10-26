import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    property string endpoint: "http://127.0.0.1:10451/api/widget/metrics"
    property string cpuText: "CPU --"
    property string ramText: "RAM --"
    property string gpuText: ""
    property string netText: "↓0B ↑0B"
    property string hostText: "Linux Resource"
    property string loadText: "Conectando..."
    property string swapText: ""
    property bool hasGpu: false
    property bool dockerAvailable: false
    property int dockerRunning: 0
    property int dockerTotal: 0
    property var dockerList: []
    property int procTotal: 0
    property int procOnline: 0
    property int procErrored: 0
    property var procList: []
    property string servicesEndpoint: "http://127.0.0.1:10451/api/widget/services"
    property string updateEndpoint: "http://127.0.0.1:10451/api/widget/update"
    property bool updateAvailable: false
    property string latestVersion: ""

    preferredRepresentation: compactRepresentation
    compactRepresentation: CompactRepresentation { }

    // Propaga o tamanho reservado do compact para o container do applet no painel
    Layout.minimumWidth: compactRepresentationItem ? compactRepresentationItem.Layout.minimumWidth : -1
    Layout.preferredWidth: compactRepresentationItem ? compactRepresentationItem.Layout.preferredWidth : -1
    Layout.maximumWidth: compactRepresentationItem ? compactRepresentationItem.Layout.maximumWidth : -1
    toolTipMainText: hostText
    toolTipSubText: loadText + (swapText ? "\n" + swapText : "")

    function formatRate(bps) {
        if (!bps || bps < 0) return "0B";
        if (bps >= 1048576) return (bps / 1048576).toFixed(1) + "M";
        if (bps >= 1024) return Math.round(bps / 1024) + "K";
        return Math.round(bps) + "B";
    }

    function formatMem(b) {
        if (!b || b <= 0) return "0M";
        if (b >= 1073741824) return (b / 1073741824).toFixed(1) + "G";
        return Math.round(b / 1048576) + "M";
    }

    function fetchUpdate() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", root.updateEndpoint, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE || xhr.status !== 200) return;
            try {
                var d = JSON.parse(xhr.responseText);
                root.updateAvailable = !!d.updateAvailable;
                root.latestVersion = d.latestVersion || "";
            } catch (e) {}
        };
        xhr.send();
    }

    function fetchServices() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", root.servicesEndpoint, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            if (xhr.status !== 200) return;
            try {
                var d = JSON.parse(xhr.responseText);
                root.dockerAvailable = !!(d.docker && d.docker.available);
                root.dockerRunning = d.docker ? d.docker.running : 0;
                root.dockerTotal = d.docker ? d.docker.total : 0;
                root.dockerList = d.docker ? d.docker.containers : [];
                root.procTotal = d.procs ? d.procs.total : 0;
                root.procOnline = d.procs ? d.procs.online : 0;
                root.procErrored = d.procs ? d.procs.errored : 0;
                root.procList = d.procs ? d.procs.list : [];
            } catch (e) {}
        };
        xhr.send();
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
                root.loadText = "Serviço offline (127.0.0.1:10451)";
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

    Timer {
        interval: 8000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.fetchServices()
    }

    Timer {
        interval: 1800000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.fetchUpdate()
    }

    fullRepresentation: Item {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 24
        Layout.preferredHeight: Kirigami.Units.gridUnit * 26
        Layout.minimumWidth: Kirigami.Units.gridUnit * 22
        Layout.minimumHeight: Kirigami.Units.gridUnit * 18

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing
            spacing: Kirigami.Units.smallSpacing

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
                text: "Rede: " + root.netText + "   ·   " + root.loadText
                font.family: "monospace"
                font.pointSize: Kirigami.Theme.smallFont.pointSize
                opacity: 0.85
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            Kirigami.Separator { Layout.fillWidth: true }

            // ---------------- Docker ----------------
            RowLayout {
                Layout.fillWidth: true
                Kirigami.Icon { source: "docker"; fallback: "application-x-executable"; Layout.preferredWidth: Kirigami.Units.iconSizes.small; Layout.preferredHeight: Kirigami.Units.iconSizes.small }
                PlasmaComponents.Label { text: "Docker"; font.bold: true }
                Item { Layout.fillWidth: true }
                PlasmaComponents.Label {
                    text: !root.dockerAvailable ? "indisponível" : (root.dockerRunning + "/" + root.dockerTotal + " ativos")
                    color: root.dockerAvailable && root.dockerRunning > 0 ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.disabledTextColor
                }
            }

            Repeater {
                model: root.dockerList
                delegate: RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing
                    Rectangle {
                        Layout.preferredWidth: 8; Layout.preferredHeight: 8; radius: 4
                        color: modelData.state === "running" ? Kirigami.Theme.positiveTextColor
                             : (modelData.state === "exited" || modelData.state === "dead") ? Kirigami.Theme.negativeTextColor
                             : Kirigami.Theme.neutralTextColor
                    }
                    PlasmaComponents.Label { text: modelData.name; elide: Text.ElideRight; Layout.fillWidth: true }
                    PlasmaComponents.Label {
                        visible: modelData.state === "running"
                        text: (modelData.cpu != null ? modelData.cpu.toFixed(1) + "%" : "") + (modelData.mem ? "  " + modelData.mem : "")
                        font.family: "monospace"
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        opacity: 0.8
                    }
                    PlasmaComponents.Label {
                        visible: modelData.state !== "running"
                        text: modelData.state
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        opacity: 0.6
                    }
                }
            }

            Kirigami.Separator { Layout.fillWidth: true }

            // ---------------- PM2 / Procman ----------------
            RowLayout {
                Layout.fillWidth: true
                Kirigami.Icon { source: "utilities-system-monitor"; Layout.preferredWidth: Kirigami.Units.iconSizes.small; Layout.preferredHeight: Kirigami.Units.iconSizes.small }
                PlasmaComponents.Label { text: "PM2 / Procman"; font.bold: true }
                Item { Layout.fillWidth: true }
                PlasmaComponents.Label {
                    text: root.procTotal === 0 ? "nenhum processo" : (root.procOnline + "/" + root.procTotal + " online" + (root.procErrored > 0 ? " · " + root.procErrored + " erro" : ""))
                    color: root.procErrored > 0 ? Kirigami.Theme.negativeTextColor
                         : root.procOnline > 0 ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.disabledTextColor
                }
            }

            Repeater {
                model: root.procList
                delegate: RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing
                    Rectangle {
                        Layout.preferredWidth: 8; Layout.preferredHeight: 8; radius: 4
                        color: modelData.status === "online" ? Kirigami.Theme.positiveTextColor
                             : modelData.status === "errored" ? Kirigami.Theme.negativeTextColor
                             : Kirigami.Theme.neutralTextColor
                    }
                    PlasmaComponents.Label {
                        text: modelData.name + "  "
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                    PlasmaComponents.Label {
                        text: modelData.engine + " · " + modelData.owner
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        opacity: 0.6
                    }
                    PlasmaComponents.Label {
                        visible: modelData.status === "online"
                        text: modelData.cpu.toFixed(0) + "%  " + root.formatMem(modelData.memory)
                        font.family: "monospace"
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        opacity: 0.8
                    }
                    PlasmaComponents.Label {
                        visible: modelData.status !== "online"
                        text: modelData.status
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        opacity: 0.6
                    }
                }
            }

            Item { Layout.fillHeight: true }

            PlasmaComponents.Button {
                visible: root.updateAvailable
                text: "⬆ Nova versão v" + root.latestVersion + " disponível — Atualizar"
                icon.name: "system-software-update"
                Layout.fillWidth: true
                onClicked: Qt.openUrlExternally("http://127.0.0.1:10450/#sobre")
            }

            PlasmaComponents.Button {
                text: "Abrir Aplicativo Linux Resource"
                icon.name: "linux-resource"
                Layout.fillWidth: true
                onClicked: Qt.openUrlExternally("http://127.0.0.1:10450")
            }
        }
    }
}
