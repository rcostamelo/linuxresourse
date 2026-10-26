import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: compact

    // Texto único da barra: CPU · RAM · [GPU] · REDE
    readonly property string barText: root.cpuText
        + "  ·  " + root.ramText
        + (root.hasGpu ? "  ·  " + root.gpuText : "")
        + "  ·  " + root.netText

    // Texto "pior caso" usado para reservar uma largura fixa e estável na barra.
    // Assim o widget nunca cresce por cima dos vizinhos quando os números mudam.
    readonly property string widestText: "CPU 100% 100°C  ·  RAM 100%"
        + (root.hasGpu ? "  ·  GPU 100%" : "")
        + "  ·  ↓999.9M ↑999.9M"

    readonly property real reservedWidth: Math.ceil(Math.max(metrics.advanceWidth, label.implicitWidth))
        + Kirigami.Units.largeSpacing * 2

    TextMetrics {
        id: metrics
        font: label.font
        text: compact.widestText
    }

    Layout.fillWidth: false
    Layout.fillHeight: true
    Layout.minimumWidth: reservedWidth
    Layout.preferredWidth: reservedWidth
    Layout.maximumWidth: reservedWidth
    implicitWidth: reservedWidth
    implicitHeight: Kirigami.Units.iconSizes.medium

    width: reservedWidth

    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        onClicked: root.expanded = !root.expanded
    }

    PlasmaComponents.Label {
        id: label
        anchors.centerIn: parent
        text: compact.barText
        font.family: "monospace"
        font.bold: true
        font.pixelSize: 11
        wrapMode: Text.NoWrap
        elide: Text.ElideNone
    }
}
