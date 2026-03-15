<template>
    <InputGroups
        v-if="!obj.fixedBitWidth"
        property-name="BitWidth:"
        :property-value="obj.bitWidth"
        property-value-type="number"
        value-min="1"
        value-max="32"
        property-input-name="newBitWidth"
        property-input-id="bitWidth"
    />
    <InputGroups
        v-if="obj.changeInputSize"
        property-name="Input Size:"
        :property-value="obj.inputSize"
        property-value-type="number"
        value-min="2"
        value-max="10"
        property-input-name="changeInputSize"
        property-input-id="inputSize"
    />
    <InputGroups
        v-if="!obj.propagationDelayFixed"
        property-name="Delay:"
        :property-value="obj.propagationDelay"
        property-value-type="number"
        value-min="0"
        value-max="100000"
        property-input-name="changePropagationDelay"
        property-input-id="delayValue"
    />
    <p v-if="!obj.disableLabel">
        <span>Label:</span>
        <input
            class="objectPropertyAttribute"
            type="text"
            name="setLabel"
            autocomplete="off"
            :value="escapeHtml(obj.label)"
        />
    </p>
    <DropdownSelect
        v-if="!obj.labelDirectionFixed"
        :dropdown-array="labelDirections"
        property-name="newLabelDirection"
        :property-value="obj.labelDirection"
        property-input-name="Label Direction:"
        property-select-id="labelDirectionValue"
    />
    <DropdownSelect
        v-if="!obj.directionFixed"
        :dropdown-array="labelDirections"
        property-name="newDirection"
        :property-value="obj.direction"
        property-input-name="Direction:"
        property-select-id="directionValue"
    />
    <DropdownSelect
        v-if="!obj.orientationFixed"
        :dropdown-array="labelDirections"
        property-name="newDirection"
        :property-value="obj.direction"
        property-input-name="Orientation:"
        property-select-id="orientationValue"
    />

    <p v-if="obj.inp && obj.inp.length > 0" class="property-hint">
        <small>Alt+click on input pins to toggle inversion bubbles</small>
    </p>

    <div v-for="(value, name) in obj.mutableProperties" :key="name" :class="{ 'prop-inline': value.sameRow }">
        <template v-if="visibilityMap[name] !== false">
            <InputGroups
                v-if="value.type === 'number'"
                :property-name="value.name"
                :property-value="obj[name]"
                property-value-type="number"
                :value-min="value.min || '0'"
                :value-max="value.max || '200'"
                :property-input-name="value.func"
                :property-input-id="value.name"
            />
            <p v-if="value.type === 'text'">
                <span>{{ value.name }}:</span>
                <input
                    class="objectPropertyAttribute"
                    type="text"
                    :name="value.func"
                    autocomplete="off"
                    :maxlength="value.maxlength || '200'"
                    :value="obj[name]"
                />
            </p>
            <p v-if="value.type === 'button'" class="btn-parent">
                <button
                    class="objectPropertyAttribute btn custom-btn--secondary"
                    type="button"
                    :name="value.func"
                >
                    {{ value.name }}
                </button>
            </p>
            <p v-if="value.type === 'textarea'">
                <span>{{ value.name }}</span>
                <textarea
                    class="objectPropertyAttribute"
                    type="text"
                    autocomplete="off"
                    rows="9"
                    :name="value.func"
                >
                    {{ obj[name] }}
                </textarea>
            </p>
            <DropdownSelect
                v-if="value.type === 'select'"
                :dropdown-array="value.options"
                :property-name="value.func"
                :property-value="String(obj[name])"
                :property-input-name="value.name + ':'"
                :property-select-id="name + 'SelectProp'"
            />
            <p v-if="value.type === 'checkbox'" class="prop-checkbox-row">
                <label>
                    <input
                        class="objectPropertyAttributeChecked"
                        type="checkbox"
                        :name="value.func"
                        :checked="!!obj[name]"
                        :value="true"
                    />
                    {{ value.name }}
                </label>
            </p>
        </template>
    </div>
</template>

<script lang="ts" setup>
import { escapeHtml } from '#/simulator/src/utils'
import InputGroups from '#/components/Panels/Shared/InputGroups.vue'
import DropdownSelect from '#/components/Panels/Shared/DropdownSelect.vue'
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
    obj: { type: Object, default: undefined },
})
const labelDirections = ['RIGHT', 'DOWN', 'LEFT', 'UP']

// obj is a plain JS object (not reactive), so we poll to detect property
// changes that affect conditional visibility.  We keep a separate reactive
// map so that Vue only re-renders when a visibility value actually flips —
// not on every tick — which prevents the label <input> from being
// destroyed/recreated (that would kill jQuery handlers and reset its value).
const visibilityMap = ref<Record<string, boolean>>({})
let _intervalId: ReturnType<typeof setInterval> | undefined

function computeVisibility(): Record<string, boolean> {
    const map: Record<string, boolean> = {}
    const mp = props.obj?.mutableProperties
    if (mp) {
        for (const [name, value] of Object.entries(mp) as [string, any][]) {
            if (!value.condition) {
                map[name] = true
            } else {
                map[name] = value.conditionValues.includes(props.obj[value.condition])
            }
        }
    }
    return map
}

function pollVisibility() {
    const next = computeVisibility()
    // Only update the ref (triggering re-render) when something changed
    const prev = visibilityMap.value
    for (const key of Object.keys(next)) {
        if (prev[key] !== next[key]) {
            visibilityMap.value = next
            return
        }
    }
    // Check for removed keys
    for (const key of Object.keys(prev)) {
        if (!(key in next)) {
            visibilityMap.value = next
            return
        }
    }
}

onMounted(() => {
    visibilityMap.value = computeVisibility()
    _intervalId = setInterval(pollVisibility, 100)
})
onUnmounted(() => { if (_intervalId !== undefined) clearInterval(_intervalId) })
</script>

<style scoped>
.prop-checkbox-row {
    display: flex;
    align-items: center;
}
.prop-checkbox-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    white-space: nowrap;
}
.prop-inline {
    display: inline-block;
    margin-right: 12px;
}
.property-hint {
    margin: 4px 0;
}
</style>
