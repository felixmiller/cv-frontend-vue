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

    <div v-for="(value, name) in obj.mutableProperties" :key="name" :class="{ 'prop-inline': value.sameRow }">
        <template v-if="isPropVisible(value, obj)">
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

// Poll every 100ms to re-evaluate conditional visibility.
// obj is a plain JS object (not reactive), so changes to its properties
// won't trigger Vue re-renders unless we force it with this counter.
const _tick = ref(0)
let _intervalId: ReturnType<typeof setInterval> | undefined
onMounted(() => { _intervalId = setInterval(() => { _tick.value++ }, 100) })
onUnmounted(() => { if (_intervalId !== undefined) clearInterval(_intervalId) })

function isPropVisible(value: any, obj: any): boolean {
    void _tick.value  // reactive dependency — forces re-evaluation on each tick
    if (!value.condition) return true
    const conditionVal = obj[value.condition]
    return value.conditionValues.includes(conditionVal)
}
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
</style>
